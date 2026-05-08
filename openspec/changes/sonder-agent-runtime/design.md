# Design: Sonder Agent Cognitive Runtime

## Architecture Overview

Sonder is a protocol first, a runtime second. The SonderEvent envelope is the contract. The event bus is the infrastructure that routes envelopes between packages. Adapters are the thin translation layer between each package's native API and the Sonder protocol.

```
┌─────────────────────────────────────────────────────────────────┐
│                         Agent Process                           │
│                                                                 │
│  ┌─────────┐   ┌─────────┐   ┌───────────┐                    │
│  │   ACR   │   │  Engram │   │ Parliament│                    │
│  │ adapter │   │ adapter │   │  adapter  │                    │
│  └────┬────┘   └────┬────┘   └─────┬─────┘                    │
│       │             │              │                            │
│       └─────────────┴──────────────┘                           │
│                          │                                      │
│              ┌───────────▼───────────┐                         │
│              │     Sonder Event Bus  │                         │
│              │   (typed, in-process) │                         │
│              └───────────┬───────────┘                         │
│                          │                                      │
│       ┌──────────────────┼──────────────────┐                  │
│       │                  │                  │                   │
│  ┌────▼────┐   ┌─────────▼──┐   ┌──────────▼┐                │
│  │ Lattice │   │    LeWM    │   │    AWM    │                │
│  │ adapter │   │  adapter   │   │  adapter  │                │
│  └────┬────┘   └────────────┘   └───────────┘                │
│       │                                                         │
│  ┌────▼──────────────────────────────────────┐                │
│  │              Audit Log                    │                │
│  │  (append-only, queryable, persistent)     │                │
│  └───────────────────────────────────────────┘                │
└─────────────────────────────────────────────────────────────────┘
```

## Event Envelope Schema

The SonderEvent is the atomic unit of the runtime. Every agent action — reasoning, memory retrieval, capability mount, handoff, prediction — produces one.

```typescript
// @sonder/core — SonderEvent v1

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
interface SonderBus {
  emit(event: SonderEvent): Promise<void>;
  on(type: string, handler: (event: SonderEvent) => void): () => void;
  onAny(handler: (event: SonderEvent) => void): () => void;
  query(filter: EventFilter): Promise<SonderEvent[]>;
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

The default implementation is in-memory with optional SQLite persistence for the audit log. Production deployments can swap the persistence layer for PostgreSQL or any append-only store.

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
2. Sonder.createEvent(agent_id, task_id, payload)
3. ACR adapter contributes → capabilities section filled
4. Engram adapter contributes → memory section filled
5. Parliament adapter contributes → reasoning section filled
6. Lattice adapter contributes → governance section filled (validates handoff)
7. LeWM adapter contributes → prediction section filled
8. AWM adapter contributes → intent section filled
9. Sonder.emit(event) → event written to audit log
10. All adapters receive observe(event) → can react/update internal state
```

This is a synchronous contribute phase followed by asynchronous observation. Total overhead target: under 5ms p99 for steps 2–9.

## Audit Log

The audit log is append-only and queryable. Every emitted SonderEvent is stored in full. The minimum queryable fields are agent_id, task_id, timestamp, validated, and violations.

The audit log is the compliance artifact. It answers:

- *What did this agent know when it acted?* → `memory.refs`
- *What was it allowed to do?* → `capabilities.mounted`
- *What did it decide and why?* → `reasoning.*`
- *Was the handoff valid?* → `governance.validated`, `governance.violations`
- *What did it predict?* → `prediction.*`
- *What did it intend to do?* → `intent.*`

## First Integration: Lattice + Engram

The first validated integration pair is Lattice + Engram. The scenario: a multi-agent pipeline where one agent writes a memory record to Engram, then hands off to a second agent. Lattice validates the handoff against a StateContract. Sonder carries both the memory context and the governance result on the same event.

This pairing is chosen because:
- Both packages are the most mature in the stack
- The failure mode (invalid handoff with no audit trail) is the most common enterprise blocker
- The integration demonstrates the compliance story end-to-end without requiring all six adapters

## Alternatives Considered

**Distributed message broker (Kafka/RabbitMQ):** Rejected. Adds infrastructure complexity without benefit for single-process agents. The event bus can be swapped for a broker in high-throughput multi-process deployments, but it should not be the default.

**OpenTelemetry spans:** Considered as the envelope format. Rejected because OTEL spans are observability primitives, not cognitive context carriers. The SonderEvent has typed, semantic fields that OTEL lacks. Sonder can *export* to OTEL for APM integration, but the envelope itself is richer.

**Single monorepo with merged packages:** Rejected. Each package must remain independently adoptable. Sonder is opt-in composition, not forced consolidation.

## Performance Targets

| Metric | Target |
|---|---|
| Event emission latency (p50) | < 1ms |
| Event emission latency (p99) | < 5ms |
| Audit log write throughput | > 1,000 events/sec |
| Audit log query latency (indexed) | < 50ms |
| SDK bundle size | < 20KB gzipped |
