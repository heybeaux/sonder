# @heybeaux/sonder-core

The event bus, envelope schema, and audit log at the heart of the Sonder cognitive runtime.

## Install

```bash
npm install @heybeaux/sonder-core
```

## What it does

`sonder-core` defines three things:

1. **`SonderEvent`** — the typed envelope that every agent action produces. It carries capability context (ACR), memory context (Engram), reasoning context (Parliament), governance context (Lattice), prediction context (LeWM), and intent context (AWM) on a single event.
2. **`SonderBus`** — the in-process event bus. Adapters register on it, events flow through it, and the audit log is written by it.
3. **`AuditLog`** — an append-only, queryable SQLite log. Every emitted `SonderEvent` is stored in full.

Most users should start with [`@heybeaux/sonder-sdk`](https://www.npmjs.com/package/@heybeaux/sonder-sdk), which wraps this package with ergonomic helpers. Use `sonder-core` directly when you need fine-grained control over the bus.

## Quick start

```typescript
import { SonderBus } from '@heybeaux/sonder-core';

const bus = new SonderBus({ dbPath: './audit.db' }); // omit dbPath for in-memory

bus.onAny((event) => {
  console.log(event.id, event.intent.action, event.governance.validated);
});

const event = await bus.emit({
  agent_id: 'agent:my-agent',
  task_id:  'task:run-001',
  payload:  { action: 'summarise', input: '...' },
});

bus.close(); // flush WAL and close SQLite
```

## `SonderBus` API

```typescript
class SonderBus {
  constructor(options?: { dbPath?: string });

  // Register an adapter — all registered adapters run in parallel during contribute()
  register(adapter: SonderAdapter): void;

  // Emit an event — runs contribute, persists, then notifies observers
  emit(base: EmitInput): Promise<SonderEvent>;

  // Subscribe to events by intent.action type
  on(type: string, handler: (event: SonderEvent) => void): () => void;

  // Subscribe to all events
  onAny(handler: (event: SonderEvent) => void): () => void;

  // Query the audit log
  query(filter: EventFilter): SonderEvent[];

  // Close the audit log
  close(): void;
}
```

## `SonderEvent` envelope

```typescript
interface SonderEvent {
  id: string;           // ULID — lexicographically sortable
  version: '1';
  agent_id: string;
  task_id: string;
  parent_id?: string;
  timestamp: string;    // ISO 8601 UTC

  capabilities: CapabilityContext;  // ACR
  memory: MemoryContext;            // Engram
  reasoning: ReasoningContext;      // Parliament
  governance: GovernanceContext;    // Lattice
  prediction: PredictionContext;    // LeWM
  intent: IntentContext;            // AWM

  payload: unknown;
  metadata?: Record<string, unknown>;
}
```

## Adapter contract

```typescript
interface SonderAdapter {
  name: string;
  version: string;
  contribute(event: Partial<SonderEvent>): Promise<Partial<SonderEvent>>;
  observe(event: SonderEvent): Promise<void>;
}
```

`contribute()` is called before an event is emitted — all adapters run in parallel and their contributions are diff-merged. `observe()` is called after emission, fire-and-forget.

## Audit log queries

```typescript
const events = bus.query({
  task_id:   'task:run-001',
  validated: true,
  from:      '2026-01-01T00:00:00Z',
  to:        '2026-12-31T23:59:59Z',
  limit:     100,
  offset:    0,
});
```

## Performance (M-series Mac, N=1000)

| Metric | Result |
|---|---|
| Emit latency p50 | 0.018 ms |
| Emit latency p99 | 0.033 ms |
| Audit log write throughput | 56,371 events/sec |
| Audit log query latency p99 | 0.227 ms |

## Packages

| Package | Description |
|---|---|
| `@heybeaux/sonder-core` | Event bus, envelope schema, audit log (this package) |
| `@heybeaux/sonder-sdk` | `createRuntime()` + `withSonder()` HOC |
| `@heybeaux/sonder-adapter-acr` | ACR capability context adapter |
| `@heybeaux/sonder-adapter-engram` | Engram memory context adapter |
| `@heybeaux/sonder-adapter-parliament` | Parliament reasoning context adapter |
| `@heybeaux/sonder-adapter-lattice` | Lattice governance context adapter |
| `@heybeaux/sonder-adapter-lewm` | LeWM prediction context adapter |
| `@heybeaux/sonder-adapter-awm` | AWM intent context adapter |

## License

MIT
