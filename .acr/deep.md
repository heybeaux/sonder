# Sonder — Deep

Loaded when designing in or debugging Sonder. Token budget ~2500.

## Architecture

```
                    ┌──────────────────────────────────┐
                    │       Caller (any agent)         │
                    │  runtime.emit({task_id, ...})    │
                    └────────────────┬─────────────────┘
                                     │
                  ┌──────────────────▼──────────────────┐
                  │           Emit Pipeline             │
                  │                                     │
                  │  redact → enforce → validate-L0 →   │
                  │  hash → sign(ed25519) → persist     │
                  └──────┬──────────────────────────────┘
                         │                ▲
            ┌────────────▼───────┐        │ contribute()
            │   SonderEventV2    │        │
            │  (signed envelope) │   ┌────┴─────────────────────┐
            └────────────────────┘   │   Faculty Adapters       │
                         │           │  ACR | Engram | Lattice  │
                         ▼           │  Parliament | AWM | LeWM │
                  SQLite audit log   └──────────────────────────┘
```

`SonderEventV2` envelope fields (the six faculty contributions, plus core):
- `capabilities` — ACR (what tools/skills the agent had available)
- `memory` — Engram (what was recalled / written)
- `reasoning` — Parliament (deliberation outcome, if any)
- `governance` — Lattice (policy + gate decisions)
- `prediction` — LeWM (forward signals, if active)
- `intent` — AWM (what the agent was trying to do)
- Core: `id` (ULID), `timestamp` (ISO8601), `agent_id`, `task_id`, `parent_id`, `payload`, `metadata`, `signature`, `hash`

## Key decisions (chronological)

- **2026-05-13** — Sonder/Ginnung product boundary lock. Sonder owns the runtime mechanism; Ginnung owns the control plane and observation surface. Faculties are independently installable. Resolved the "Ginnung is a brand without a product" ambiguity.
- **2026-05-14** — Fencing architecture: Sonder owns the pre-emit `checkGate` hook (mechanism); Lattice + AWM own the policy. Ginnung is the surface where gates are configured. v1 is turn-level gating only; substep gating deferred to v1.5.
- **(earlier)** — `createRuntime()` factory pattern chosen over class instantiation so adapter registration is declarative and the runtime can be wrapped (`withSonder()` HOC).
- **(earlier)** — `parent_id` chain over `trace_id` for causality. Reason: a single task can have many parallel branches; `parent_id` gives a true DAG without forcing a single linear trace.

## Recent incidents / hard-won lessons

- **Adapter contribution timing matters.** Adapters that hit external services (Engram, Lattice) need bounded timeouts; otherwise emit blocks. Default: 2s per adapter, fail-closed on governance.
- **Chain verification is not free.** `verifyChain()` walks the whole audit log; on multi-thousand-event chains it's a notable cost. Use anchor manifests (`buildAnchorManifest()`) to checkpoint compliance state instead of full re-verify.

## Internal naming / vocabulary

- **L0 validation** = schema-level validation of the SonderEvent envelope itself (required fields, type checks)
- **Six faculties** = capabilities, memory, reasoning, governance, prediction, intent. Each has a name (ACR, Engram, Parliament, Lattice, LeWM, AWM) and a field on the envelope.
- **Anchor** = a periodic external manifest of audit-chain state (for compliance / external attestation use cases)
- **SonderAdapter** = the interface a faculty implements to contribute its field to the SonderEvent

## Boundaries

- Sonder **does** carry the signed envelope, run the emit pipeline, persist audit log, sign with ed25519, verify chains.
- Sonder **does not** make policy decisions (that's Lattice), recall memory (that's Engram), deliberate (that's Parliament), predict (that's LeWM), or render UIs (that's Ginnung).
- Sonder is **not bus-agnostic in v1**. Ginnung only runs on Sonder. Don't generalize until real demand shows up.

## Open questions / parked work

- **Substep-level gating** (v1.5). Currently only turn-level `checkGate` is implemented. Substep gating waits until a real use case forces the design.
- **External anchor target.** Manifests can be generated but the "where to send them" (transparency log? external chain? customer-defined webhook?) is undecided.
- **OpenAI tool-call elaboration** — Endeavour Idea ffbdde7d locked the Option 2 shape: new `/v1/chat/completions`, internal loop runs first, caller executes tools. Implementation status as of 2026-04-27 was "locked, pending build."
