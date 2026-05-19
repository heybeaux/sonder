# Sonder

**Purpose:** Agent cognitive runtime. A signed event bus where every agent action emits a typed `SonderEventV2` carrying structured context from six faculties (capabilities, memory, reasoning, governance, prediction, intent) plus an ed25519-signed audit chain. Sonder is the substrate every heybeaux agent runs on; faculties plug in via the `SonderAdapter` interface.

**Repo:** https://github.com/heybeaux/sonder
**Status:** active
**Phase:** runtime product GA — packages published, used by Inos in-process
**Last verified:** 2026-05-18

## Runtime

- **Local path:** /Users/beauxwalton/projects/sonder
- **Tech:** TypeScript monorepo, pnpm workspace, Turbo
- **Build:** `pnpm install && pnpm build`
- **Test:** `pnpm test` (Vitest)
- **Packages (under `packages/`):**
  - `@heybeaux/sonder-core` — bus, event types (`SonderEventV2`, `SonderEventCore`), keypair loader, `SensitivityLevel`, `SonderAdapter` interface
  - `@heybeaux/sonder-sdk` — `createRuntime()`, `withSonder()` HOC, `createEmitPipeline()`, `verifyChain()`, `buildAnchorManifest()` + CLIs `sonder-verify-chain`, `sonder-anchor`
- **Audit storage:** SQLite (`dbPath` config, default `./audit.db`)
- **Keys:** ed25519 keypair at `keyPath` config OR `SONDER_KEY_PATH` env OR `~/.sonder/key`

## Integration shape (the 90% case)

```ts
import { createRuntime } from '@heybeaux/sonder-sdk';
const runtime = createRuntime({
  adapters: [/* SonderAdapter instances per faculty */],
  dbPath: './audit.db',
  keyPath: './keys/sonder-key',
  redaction: { sensitivityLevel: 'standard' },
});
const event = await runtime.emit({ agent_id, task_id, parent_id, payload });
runtime.shutdown();
```

**Emit pipeline:** redact → enforce → validate-L0 → hash → sign → persist. Caller never manages signing — `runtime.emit()` returns the signed event with all six faculty fields auto-populated by registered adapters.

## Dependencies

- **Depends on:** none at runtime — Sonder is the substrate. Faculties depend on it, not the other way around.
- **Used by:** Ginnung (observes event stream for cockpit), Inos (in-process for node-mutation events), every other faculty's adapter
- **External:** SQLite, `@noble/ed25519` for signing, ULID for event ids

## Key contacts

- **Owner:** @beauxwalton
- **Recent contributors:** @beauxwalton (primary); Pax + Rook for spec/review

## Quick gotchas

- **Sonder ≠ Ginnung.** Sonder is runtime, Ginnung is control plane. Locked 2026-05-13. Never conflate in PRs, docs, or commits.
- **Don't bypass `runtime.emit()`** — signing + redaction + L0 validation happen there; ad-hoc event construction loses the audit chain.
- **`parent_id` is load-bearing** — it's what builds the causal chain per task. Always pass the previous event's id when continuing work.
- **Sonder package names are `@heybeaux/sonder-*`** — not `@sonder/*` or `@hb/sonder-*`.
- **Domain is `sonder.ginnung.ai`** — sonder.ai/.dev/.com are unavailable; that's *why* Ginnung exists as the umbrella domain.

## Where to learn more

- `deep.md` — the SonderEvent envelope, faculty contribution model, anchor protocol
- `README.md` in the repo — public-facing pitch + architecture
- Sonder marketing page: https://sonder.ginnung.ai
