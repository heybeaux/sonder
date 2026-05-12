# Tasks: Sonder Agent Cognitive Runtime

## Phase 1 — Core Protocol (Week 1–2)

### 1.1 Define SonderEvent TypeScript types
- Generate `packages/core/src/types/event.ts` with all envelope fields typed
- Export `SonderEvent`, `LODLevel`, `EventFilter`, `SonderAdapter` interfaces
- Add JSDoc on each field explaining the source package
- Done: `tsc --noEmit` passes; types are exported from `@heybeaux/sonder-core`

### 1.2 Implement ULID event ID generation
- Add `ulidx` dependency to core
- Implement `createEventId(): string` utility
- Done: IDs are monotonically sortable; 10,000 IDs generated with no collisions

### 1.3 Implement in-memory event bus
- `SonderBus` class with `emit()`, `on()`, `onAny()`, `query()` methods
- Synchronous contribute phase (awaits all adapter `contribute()` calls in parallel)
- Asynchronous observe phase (fires and forgets all adapter `observe()` calls)
- Done: Unit tests cover emit, subscribe, query, and adapter lifecycle

### 1.4 Implement SQLite audit log persistence
- Append-only write on every `emit()`
- Indexed on `agent_id`, `task_id`, `timestamp`, `validated`
- `query(EventFilter)` maps to SQL with parameterized queries
- Done: 1,000 events written and queried in under 100ms on M-series Mac

### 1.5 Publish `@heybeaux/sonder-core` to npm at v0.1.0
- Monorepo setup with pnpm workspaces and tsup bundling
- MIT license, full TypeScript types included
- Done: `npm install @heybeaux/sonder-core` works; types resolve correctly

---

## Phase 2 — First Integration Pair: Lattice + Engram (Week 3–4)

### 2.1 Implement Lattice adapter
- `contribute()`: reads active StateContract, circuit state, and last validation result
- `observe()`: updates circuit breaker state on governance violations in other events
- Done: Lattice adapter fills `governance.*` correctly for a known StateContract

### 2.2 Implement Engram adapter
- `contribute()`: reads last retrieval result from Engram session context (memory refs, query, confidence)
- `observe()`: no-op in v1 (Engram does not need to react to other events yet)
- Done: Engram adapter fills `memory.*` correctly for a known retrieval

### 2.3 End-to-end demo: Forge LinkedIn pipeline
- Multi-agent pipeline: Research agent → Draft agent → Approval agent
- Each agent emits SonderEvents with Lattice + Engram adapters registered
- Audit log is queryable after the run; violations are surfaced
- Done: Full pipeline runs; audit log shows complete cognitive trail for all three agents

### 2.4 Performance validation
- Measure p50 and p99 emit latency with both adapters registered
- Target: p99 < 5ms
- Done: Benchmark results documented in `benchmarks/` with actual numbers

---

## Phase 3 — Remaining Adapters (Week 5–7)

### 3.1 ACR adapter
- `contribute()`: reads `capabilities.registry()` for mounted IDs, LOD levels, and budget state
- Done: ACR adapter fills `capabilities.*` correctly

### 3.2 Parliament adapter
- `contribute()`: reads last deliberation result — model, neurotypes, consensus, dissent, OSI, rounds
- Done: Parliament adapter fills `reasoning.*` correctly

### 3.3 LeWM adapter
- `contribute()`: reads current prediction — outcome, Beta distribution parameters, model ID
- `observe()`: updates outcome model on governance violations (Lattice) and AWM step traces
- Done: LeWM adapter fills `prediction.*` correctly; observe hook updates Beta parameters

### 3.4 AWM adapter
- `contribute()`: reads current StepTrace — action, skip status, constraint injection
- `observe()`: reads prediction results from LeWM events to close the learning loop
- Done: AWM adapter fills `intent.*` correctly; closed-loop learning validated

---

## Phase 4 — SDK and Developer Experience (Week 8)

### 4.1 Publish `@heybeaux/sonder-sdk`
- `createRuntime(config)` factory — registers adapters, returns configured SonderBus
- `withSonder(agentFn)` HOC — wraps any async agent function with automatic event emission
- Done: A new framework integration takes under 30 minutes following the README

### 4.2 OpenSpec compliance
- All specs in `openspec/changes/sonder-agent-runtime/specs/` have passing acceptance criteria
- Done: Each scenario in `specs/envelope.md` has a corresponding integration test

### 4.3 Documentation
- `docs/getting-started.md` — 5-minute integration guide
- `docs/adapters.md` — how to write a custom adapter
- `docs/audit-log.md` — querying the audit log for compliance use cases
- Done: A developer unfamiliar with Sonder can integrate it following the docs alone

---

## Dependencies

- Phase 2 depends on Phase 1.5 (`@heybeaux/sonder-core` published)
- Phase 3 depends on Phase 2.4 (performance validated before adding more adapters)
- Phase 4 depends on Phase 3 (all adapters must exist before SDK wraps them)
- Lattice OpenAI provider (L3 validation) must be implemented before full Lattice adapter validation
