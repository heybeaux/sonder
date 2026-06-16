# Sonder: AI Agent Cognitive Runtime

Sonder is the event bus that binds six independent AI agent faculties — capability, memory, reasoning, governance, prediction, and intent — into a unified cognitive runtime. Every agent action emits a typed `SonderEvent` carrying structured context from all six faculties simultaneously, producing a queryable audit trail that answers what the agent knew, what it was authorized to do, and why it decided what it decided.

## Why It Exists

Multi-agent systems fail silently. Cemri et al. (2025) analyzed 1,600+ execution traces across 7 frameworks and found that ~79% of failures are coordination-related — specification gaps (~42%) and inter-agent misalignment (~37%) — versus only ~21% from base-model reasoning failures. State-of-the-art systems like ChatDev achieve only 25% baseline correctness. A single broken handoff cascades through a pipeline with no explanation and no way to diagnose root cause.

The architectural gap is that every existing observability platform (LangSmith, Langfuse, Arize Phoenix, AgentOps) instruments the execution layer — timing, tokens, tool calls. None carry structured cognitive context: what memory was active, what the agent was permitted to do, what reasoning path was taken, whether the handoff was validated, what outcome was predicted. That cognitive context is exactly what you need to diagnose a coordination failure — and it evaporates the moment a turn ends. Sonder makes it a durable, queryable record.

## Core Architecture

Sonder organizes agent cognition into six faculties:

| Faculty | Package | Question |
|---|---|---|
| Can do | ACR | What capabilities are mounted at what resolution? |
| Knows | Engram | What memory was consulted, and with what confidence? |
| Thinks | Parliament | What did deliberation conclude, and was there dissent? |
| Did | Lattice | Was the handoff valid against the state contract? |
| Thinks will happen | LeWM | What outcome is predicted, with what Bayesian confidence? |
| Will do | AWM | What action is planned, and what does the StepTrace show? |

## The Event Envelope

Every agent action produces a `SonderEvent` — a typed envelope carrying context from all six faculties:

```typescript
interface SonderEvent {
  id: string;           // ULID
  agent_id: string;
  task_id: string;
  parent_id?: string;   // causal chain
  timestamp: string;    // ISO 8601 UTC

  capabilities: { mounted: string[]; resolution: Record<string, LODLevel>; budget_used: number; budget_limit: number; };
  memory:       { refs: string[]; query?: string; confidence: number; dream_cycle?: string; };
  reasoning:    { model: string; neurotypes: string[]; consensus: boolean; dissent: string[]; osi: number; rounds: number; };
  governance:   { contract_id: string; validated: boolean; l1_pass: boolean; l2_pass: boolean; l3_pass: boolean; violations: string[]; circuit_state: 'closed' | 'open' | 'half-open'; };
  prediction:   { outcome: string; confidence: number; alpha: number; beta: number; model_id: string; };
  intent:       { action: string; step_trace_id: string; skipped: boolean; skip_reason?: string; constraint_injected: boolean; };

  payload: unknown;
  metadata?: Record<string, unknown>;
}
```

The audit log answers the five questions regulated industries require:

| Question | Field |
|---|---|
| What did the agent know? | `memory.refs` |
| What was it authorized to do? | `capabilities.mounted` |
| Why did it decide this? | `reasoning.*` |
| Was the handoff valid? | `governance.validated`, `governance.violations` |
| What did it predict? | `prediction.*` |

## Regulatory Context

Sonder's audit log directly addresses mandates taking effect in 2026:

- **EU AI Act Article 12 (August 2, 2026)**: High-risk AI systems must maintain logs sufficient to reconstruct decision context on regulatory demand. Non-compliance: up to €15M or 3% of global annual turnover.
- **ESMA / MiFID II (in force)**: Firms must explain how AI impacts algorithm decisions to supervisors on request. 5-year record retention required.
- **FINRA 2026**: Firms must reconstruct "the chain of reasoning an agent used if a trade or communication is flagged."
- **HIPAA**: Each discrete AI action in a healthcare workflow requires timestamped, auditable logs including confidence scores and model version.

No existing observability tool provides structured cognitive context for these requirements. Sonder does.

## Theoretical Foundation

Sonder is a computational instantiation of Global Workspace Theory (Baars, 1988) — the cognitive science model that consciousness functions as a shared broadcast substrate where all specialized modules receive the same context simultaneously. Each SonderEvent is that broadcast. The Memory/Parliament/AWM triad extends the BDI architecture (Rao & Georgeff, 1995). Governance and Prediction are first-class faculties absent from every classical cognitive architecture (ACT-R, SOAR, LIDA) and from the CoALA framework (Sumers et al., 2023) — these are Sonder's structural contributions to the design space.

## Status

Early design phase. Using OpenSpec for formal change documentation.

- [Proposal](openspec/changes/sonder-agent-runtime/proposal.md)
- [Design](openspec/changes/sonder-agent-runtime/design.md)
