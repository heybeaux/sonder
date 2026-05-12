# Design: Sonder Agent Cognitive Runtime

## Architecture Overview

Sonder is a protocol first, a runtime second. The SonderEvent envelope is the contract. The event bus is the infrastructure that routes envelopes between packages. Adapters are the thin translation layer between each package's native API and the Sonder protocol.

```
┌─────────────────────────────────────────────────────────────────┐
│                         Agent Process                           │
│                                                                 │
│  ┌───────┐ ┌────────┐ ┌──────────┐ ┌───────┐ ┌──────┐ ┌─────┐ │
│  │  ACR  │ │ Engram │ │Parliament│ │Lattice│ │ LeWM │ │ AWM │ │
│  │adapter│ │adapter │ │ adapter  │ │adapter│ │adapt.│ │adapt│ │
│  └───┬───┘ └───┬────┘ └────┬─────┘ └───┬───┘ └──┬───┘ └──┬──┘ │
│      │         │           │           │         │         │    │
│      └─────────┴───────────┴─────┬─────┴─────────┴─────────┘   │
│                                  │  contribute() — parallel     │
│              ┌───────────────────▼───────────┐                  │
│              │        Sonder Event Bus        │                  │
│              │      (typed, in-process)       │                  │
│              └───────────────────┬───────────┘                  │
│                                  │  observe()  — fire & forget  │
│      ┌───────────────────────────┴──────────────────────────┐   │
│      │  all adapters receive the fully-assembled event       │   │
│      └───────────────────────────────────────────────────────┘   │
│                                  │                               │
│  ┌───────────────────────────────▼───────────────────────────┐  │
│  │                       Audit Log                           │  │
│  │           (append-only, SQLite, queryable)                │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Event Envelope Schema

The SonderEvent is the atomic unit of the runtime. Every agent action — reasoning, memory retrieval, capability mount, handoff, prediction — produces one.

```typescript
// @heybeaux/sonder-core — SonderEvent v1

interface SonderEvent {
  // Identity
  id: string;              // ULID — lexicographically sortable, globally unique
  version: '1';            // envelope schema version
  agent_id: string;        // stable identity across sessions (set by host)
  task_id: string;         // logical task grouping (e.g., pipeline run ID)
  parent_id?: string;      // parent event ID for causal chains
  timestamp: string;       // ISO 8601, UTC

  // ACR — capability context at time of event
  capabilities: {
    mounted: string[];     // capability IDs currently mounted
    resolution: Record<string, LODLevel>;  // LOD per capability
    budget_used: number;   // tokens consumed by capability instructions
    budget_limit: number;  // total token budget
  };

  // Engram — memory context
  memory: {
    refs: string[];        // memory record IDs consulted
    query?: string;        // semantic query used for retrieval
    confidence: number;    // 0–1 ensemble retrieval confidence
    dream_cycle?: string;  // consolidation cycle ID if post-dream
  };

  // Parliament — reasoning context
  reasoning: {
    model: string;         // primary model used
    neurotypes: string[];  // active neurotypes in deliberation
    consensus: boolean;    // true if all neurotypes agreed
    dissent: string[];     // neurotype IDs that dissented
    osi: number;           // Opinion Shift Index (echo chamber detection)
    rounds: number;        // deliberation rounds taken
  };

  // Lattice — governance context
  governance: {
    contract_id: string;   // Lattice StateContract that governed this event
    validated: boolean;    // true if all validation layers passed
    l1_pass: boolean;      // structural (JSON schema) validation
    l2_pass: boolean;      // semantic (embedding similarity) validation
    l3_pass: boolean;      // LLM-as-judge hallucination detection
    violations: string[];  // validation failure codes
    circuit_state: 'closed' | 'open' | 'half-open';
  };

  // LeWM — prediction context
  prediction: {
    outcome: string;       // predicted outcome label
    confidence: number;    // 0–1 Bayesian Beta distribution mean
    alpha: number;         // Beta distribution alpha (successes)
    beta: number;          // Beta distribution beta (failures)
    model_id: string;      // LeWM model that produced prediction
  };

  // AWM — intent context
  intent: {
    action: string;        // the action being taken
    step_trace_id: string; // AWM StepTrace reference
    skipped: boolean;      // true if step was skipped on high confidence
    skip_reason?: string;  // reason for skip
    constraint_injected: boolean;  // true if approval gate pre-injected constraints
  };

  payload: unknown;        // the actual event data (action input/output)
  metadata?: Record<string, unknown>;  // host-defined extension point
}

type LODLevel = 'index' | 'summary' | 'standard' | 'deep';
```

## Event Bus

The event bus is intentionally minimal. It is an in-process typed event emitter with persistence hooks — not a distributed message broker. Sonder does not require Kafka, Redis, or any external infrastructure.

```typescript
class SonderBus {
  // Register an adapter — all adapters run in parallel during contribute()
  register(adapter: SonderAdapter): void;

  // Emit an event — runs contribute phase (parallel), persists, then observe phase (async)
  emit(
    base: Pick<SonderEvent, 'agent_id' | 'task_id' | 'payload'> &
      Partial<Omit<SonderEvent, 'id' | 'version' | 'timestamp'>>,
  ): Promise<SonderEvent>;

  // Subscribe to events by intent action type
  on(type: string, handler: (event: SonderEvent) => void): () => void;

  // Subscribe to all events
  onAny(handler: (event: SonderEvent) => void): () => void;

  // Query the audit log synchronously
  query(filter: EventFilter): SonderEvent[];

  // Close the audit log (call on shutdown)
  close(): void;
}

interface EventFilter {
  agent_id?: string;
  task_id?: string;
  from?: string;       // ISO 8601
  to?: string;         // ISO 8601
  validated?: boolean;
  violations?: string[];
  limit?: number;
  offset?: number;
}
```

The default implementation is in-memory with optional SQLite persistence for the audit log (pass `dbPath` to persist across restarts). Production deployments can swap the persistence layer by extending `AuditLog` from `@heybeaux/sonder-core`.

The higher-level `@heybeaux/sonder-sdk` package wraps `SonderBus` with two ergonomic entry points:

```typescript
// Factory: registers adapters on a configured bus
createRuntime(config: RuntimeConfig): { bus: SonderBus; shutdown(): void }

// HOC: wraps any async agent function with automatic before/after event emission
withSonder<TInput, TOutput>(fn, options): WrappedAgentFn<TInput, TOutput>
```

## Adapter Contract

Each package adapter implements a single interface:

```typescript
interface SonderAdapter {
  name: string;                  // e.g., 'acr', 'engram', 'lattice'
  version: string;               // adapter semver
  contribute(event: Partial<SonderEvent>): Promise<Partial<SonderEvent>>;
  observe(event: SonderEvent): Promise<void>;  // called after event is emitted
}
```

`contribute()` is called before an event is emitted. Each adapter fills in its section of the envelope from its own internal state. `observe()` is called after emission, allowing adapters to react to other packages' events (e.g., AWM observing Lattice violations to update outcome models).

## Integration Sequence

A typical agent action flows through Sonder like this:

```
1. Agent prepares to act
2. bus.emit({ agent_id, task_id, payload })
3. All adapters called in parallel: contribute(partialEvent)
   → ACR fills capabilities.*
   → Engram fills memory.*
   → Parliament fills reasoning.*
   → Lattice fills governance.*
   → LeWM fills prediction.*
   → AWM fills intent.*
4. Contributions merged (diff-only — each adapter's changed keys only)
5. Fully-assembled SonderEvent written to audit log
6. Typed and wildcard handlers notified synchronously
7. All adapters called fire-and-forget: observe(event)
   → LeWM: onGovernanceOutcome() called if contract_id present
   → AWM: onStepOutcome() called if step_trace_id + contract_id present
8. bus.emit() resolves with the fully-assembled SonderEvent
```

The contribute phase is parallel; the observe phase is fire-and-forget. Step 4 merges contributions as diffs (keys changed from the snapshot) so adapters can safely spread the full event in `contribute()` without clobbering each other.

## Audit Log

The audit log is append-only and queryable. Every emitted SonderEvent is stored in full. The minimum queryable fields are agent_id, task_id, timestamp, validated, and violations.

The audit log is the compliance artifact. It answers the five questions regulated industries require:

| Question | Field | Regulation |
|---|---|---|
| What did the agent know? | `memory.refs` | HIPAA, EU AI Act Art. 12 |
| What was it authorized to do? | `capabilities.mounted` | FINRA 2026, MiFID II RTS 6 |
| What did it decide and why? | `reasoning.*` | ESMA Feb 2026, FCA Consumer Duty |
| Was the handoff valid? | `governance.validated`, `governance.violations` | EU AI Act Art. 12, NAIC Model Bulletin |
| What did it predict? | `prediction.*` | SEC AI oversight, CFTC Oct 2024 Advisory |

## Observe Loop: LeWM ↔ AWM

The observe loop closes the prediction-calibration feedback cycle between LeWM and AWM.

**LeWM** is the hypothesis generator — it produces structured predictions using learned world model representations (Beta distribution parameters, outcome labels, model IDs). When it observes governance outcomes via `onGovernanceOutcome()`, it updates its internal beliefs: alpha increments on pass, beta increments on fail.

**AWM** is the calibration layer — it tracks historical step frequencies and scores LeWM's predictions against actual outcomes. When it observes a completed step via `onStepOutcome()`, it records the trace result, which updates its frequency model for that step type. Over time AWM's calibration tells you how much weight to place on LeWM's structural predictions.

Both callbacks are optional — the observe loop only activates when host code supplies them. Events without a `contract_id` or `step_trace_id` are silently skipped.

## First Integration: Lattice + Engram

The first validated integration pair is Lattice + Engram. The scenario: a multi-agent pipeline where one agent writes a memory record to Engram, then hands off to a second agent. Lattice validates the handoff against a StateContract. Sonder carries both the memory context and the governance result on the same event.

This pairing is chosen because:
- Both packages are the most mature in the stack
- The failure mode (invalid handoff with no audit trail) is the most common enterprise blocker
- The integration demonstrates the compliance story end-to-end without requiring all six adapters

## Alternatives Considered

**Distributed message broker (Kafka/RabbitMQ):** Rejected. Adds infrastructure complexity without benefit for single-process agents. The event bus can be swapped for a broker in high-throughput multi-process deployments, but it should not be the default.

**OpenTelemetry spans:** Considered as the envelope format. Rejected because OTEL spans are observability primitives, not cognitive context carriers. The OTel GenAI SIG explicitly defers cognitive context fields (memory state, governance context, reasoning chains, predicted outcomes, intent) to the application layer as out of scope for the standard. The SonderEvent has typed, semantic fields that OTel lacks. Sonder can *export* to OTel for APM integration, but the envelope itself is richer and serves a different purpose.

**Single monorepo with merged packages:** Rejected. Each package must remain independently adoptable. Sonder is opt-in composition, not forced consolidation.

## Performance Targets

| Metric | Target | Actual (M-series Mac, N=1000) |
|---|---|---|
| Event emission latency (p50) | < 1ms | 0.018ms |
| Event emission latency (p99) | < 5ms | 0.033ms |
| Audit log write throughput | > 1,000 events/sec | 56,371 events/sec |
| Audit log query latency (p99, indexed) | < 50ms | 0.227ms |
| SDK bundle size | < 20KB gzipped | — |

Benchmarks run with 3 adapters registered (Lattice + Engram + Parliament). Results stored in `benchmarks/results.json`.

---
