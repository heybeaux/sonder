# Audit Log

Every `SonderEvent` emitted by the bus is automatically persisted to an append-only SQLite audit log. The log is the compliance artifact — it answers the five questions regulated industries require on demand.

| Question | Field | Regulation |
|---|---|---|
| What did the agent know? | `memory.refs` | HIPAA, EU AI Act Art. 12 |
| What was it authorized to do? | `capabilities.mounted` | FINRA 2026, MiFID II RTS 6 |
| What did it decide and why? | `reasoning.*` | ESMA Feb 2026, FCA Consumer Duty |
| Was the handoff valid? | `governance.validated`, `governance.violations` | EU AI Act Art. 12, NAIC Model Bulletin |
| What did it predict? | `prediction.*` | SEC AI oversight, CFTC Oct 2024 Advisory |

---

## Setup

By default the audit log is in-memory (lost on shutdown). For persistence, pass a `dbPath`:

```typescript
const runtime = createRuntime({
  dbPath: './audit.db',   // SQLite file — created if it doesn't exist
  adapters: [...],
});
```

The database uses WAL mode for concurrent reads and is indexed on `agent_id`, `task_id`, `timestamp`, and `validated`.

---

## Querying

Use `runtime.bus.query()` with an `EventFilter`:

```typescript
const events = runtime.bus.query({
  agent_id: 'agent:draft',          // filter by agent
  task_id: 'task:linkedin-post',    // filter by task
  from: '2026-05-09T00:00:00Z',     // ISO 8601 start
  to: '2026-05-09T23:59:59Z',       // ISO 8601 end
  validated: false,                  // only governance failures
  limit: 100,
  offset: 0,
});
```

All filters are optional and composable. Returns `SonderEvent[]` sorted by timestamp ascending.

---

## Common Queries

### All events for a pipeline run

```typescript
const events = runtime.bus.query({ task_id: 'task:my-pipeline-run' });
```

### Governance violations in the last 24 hours

```typescript
const violations = runtime.bus.query({
  validated: false,
  from: new Date(Date.now() - 86_400_000).toISOString(),
});

for (const e of violations) {
  console.log(`[${e.id}] ${e.agent_id} — ${e.governance.violations.join(', ')}`);
}
```

### All events for a specific agent

```typescript
const agentHistory = runtime.bus.query({ agent_id: 'agent:approval' });
```

### Reconstruct a decision audit trail

```typescript
const events = runtime.bus.query({ task_id: 'task:flagged-trade-2026-05-09' });

for (const e of events) {
  console.log(`
Agent:      ${e.agent_id}
Time:       ${e.timestamp}
Knew:       ${e.memory.refs.join(', ')}
Authorized: ${e.capabilities.mounted.join(', ')}
Decided:    consensus=${e.reasoning.consensus} model=${e.reasoning.model} rounds=${e.reasoning.rounds}
Valid:      ${e.governance.validated} violations=${JSON.stringify(e.governance.violations)}
Predicted:  ${e.prediction.outcome} (confidence=${e.prediction.confidence})
  `.trim());
}
```

---

## Event Structure

Every persisted event is a full `SonderEvent` stored as JSON. All fields are available for inspection:

```typescript
interface SonderEvent {
  id: string;           // ULID — lexicographically sortable
  version: '1';
  agent_id: string;
  task_id: string;
  parent_id?: string;   // causal chain link
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

---

## Production Storage

The default SQLite backend is suitable for single-process agents and development. For high-throughput multi-process deployments, swap the persistence layer by extending `AuditLog` from `@heybeaux/sonder-core`:

```typescript
import { AuditLog } from '@heybeaux/sonder-core';

class PostgresAuditLog extends AuditLog {
  // Override write() and query() to use your Postgres pool
}
```

Then pass it to `SonderBus` directly instead of using `createRuntime()`.

---

## Retention

The audit log is append-only — events are never modified or deleted by Sonder. Implement retention policies at the storage layer (e.g., SQLite `DELETE WHERE timestamp < cutoff`, or Postgres partitioning by month).

Minimum retention requirements by regulation:

| Regulation | Minimum Retention |
|---|---|
| HIPAA 45 CFR 164.312(b) | 6 years |
| MiFID II RTS 6 | 5 years |
| FINRA 2026 | As required by applicable rule (typically 3–7 years) |
| EU AI Act Art. 12 | Duration of system lifecycle + post-market monitoring period |
