# Proposal: Sonder Audit Log — Merkle Hash Chain + Pre-Sign Redaction

## Intent

The public Ginnung thesis claims SonderEvents are *"signed by the runtime, append-only, queryable."* Today (post-v0.1), Sonder's audit log is:

- **Not signed** — `SonderEvent` has no `signature` field; the runtime does not invoke ed25519.
- **Not chain-verifiable** — events are inserted into SQLite with no inter-event hash linkage. "Append-only" is a database property, not a cryptographic one. A row delete leaves no trace.
- **Not redaction-safe** — events carry `payload: unknown` with no PII redaction stage. The Ginnung dogfood thesis (Spec 3) is *"publish every essay alongside its `sonderevent.ndjson` log"* — without redaction, publication is reckless.

The 2026-05-11 Parliament 8-model direction-setting run (see `heybeaux/ops:reports/ginnung-direction-2026-05-11.md`) flagged both of these as load-bearing gaps:

> The "append-only" log claim is currently unverifiable and risks exposing sensitive data; this will be fixed by implementing a Merkle hash chain for tamper-evidence and adding a pre-signature redaction stage to mask PII.

This proposal makes the thesis claim true. Three additions to Sonder's audit pipeline:

1. **Pre-sign redaction stage** — masks PII before any signature is computed. Reuses `redactContract` from `@heybeaux/lattice-core` (the same utility that already guards the L2/L3 provider boundary).
2. **Ed25519 signing** — the redacted, canonicalized event is signed; `signature` becomes a required field on `SonderEvent`.
3. **Merkle hash chain** — each event carries `chain_prev_hash` and `chain_self_hash`. A daily anchor of the latest `chain_self_hash` is published to a public location (git tag on a public repo) so external verifiers can prove the log was not retroactively edited up to the anchor point.

## Scope

### In scope

- **Redaction stage** before signing:
  - Reuse `@heybeaux/lattice-core`'s `redactContract` with `SensitivityLevel = 'high'` as default. Applied to `payload` and `metadata`.
  - Emit a `redaction` evidence block: `{ fields: string[]; count: number; sensitivityLevel: SensitivityLevel }`. `fields` lists which JSONPaths were redacted (the paths, not the values). Always present even when nothing was redacted (empty array, count=0).
  - Refusal: if any field marked `must-not-redact` is missing post-redaction, signing fails. Prevents accidental over-redaction of audit-critical fields like `agent_id` or `governance.contract_id`.
- **Ed25519 signing**:
  - Sonder runtime ships with a per-instance ed25519 keypair generated on first run, persisted to a configurable path (`~/.sonder/key` by default), exposed via SDK as `runtime.publicKey`.
  - Signed payload = canonicalized JSON of the redacted event **minus the `signature` field** (otherwise signing is recursive).
  - `signature` becomes a required field on `SonderEvent` schema (`SonderEvent.version` bumps to `'2'`).
  - SDK API: `await runtime.emit(event)` returns the signed event including `chain_self_hash` and `signature`.
- **Merkle hash chain**:
  - Each event carries:
    - `chain_prev_hash: string` — hex of the previous event's `chain_self_hash`. The very first event in a chain uses `'genesis:<agent_id>:<iso8601>'` as the seed.
    - `chain_self_hash: string` — `sha256(canonicalize(event without chain_self_hash))`.
  - **Per-agent chain**: each `agent_id` has its own chain. Cross-agent comparison is not part of v0.2 (deferred to v0.3 with explicit consent semantics).
  - The AuditLog persists `chain_prev_hash` and `chain_self_hash` as indexed columns.
  - Verifier CLI: `sonder verify-chain --agent-id <id> [--from <event_id>]` walks the chain in order, recomputes each `chain_self_hash`, and asserts equality. Mismatch → exit 1 with the first offending event id.
- **Daily public anchor**:
  - A scheduled task (Sonder ships the script; the schedule lives in `~/.openclaw/crons/` or equivalent) reads the latest `chain_self_hash` per agent and publishes a JSON anchor manifest as a tagged commit on a configurable public repo (default `heybeaux/sonder-anchors`).
  - Anchor manifest format: `{ agent_id: string; chain_head: string; head_event_id: string; head_timestamp: string; anchored_at: string }[]`.
  - External verifiers fetch the anchor and walk the chain back from `head_event_id` to validate.

### Out of scope (deferred)

- **Cross-agent linkage** — making one global chain across all agents. Defer to v0.3.
- **Selective disclosure** — publishing a subset of events with a zero-knowledge proof of chain membership. Defer indefinitely; not needed for the dogfood thesis.
- **Key rotation** — runtime keypair rotation with overlap windows. Defer to v0.3. v0.2 assumes a stable key for the chain's lifetime; rotation invalidates the chain (a clean break is documented as the migration path).
- **Hardware-backed signing** — TPM / Secure Enclave. Defer indefinitely.
- **Anchor decentralization** — anchoring to Bitcoin / Ethereum / Sigstore. Defer; git-tag-to-public-repo is sufficient for v0.2's audit story.
- **Encrypted-at-rest payloads** — orthogonal. The redaction stage is the v0.2 PII guarantee.

## Why this is load-bearing

The Ginnung public thesis says the runtime signs events and the log is append-only. Right now, those claims are aspirational. The dogfood strategy (Spec 3) requires **publishing logs publicly** — which requires both:

- Redaction (so we don't leak PII when publishing).
- Verifiability (so a published log is more than a JSON blob).

Without Spec 2, Spec 3 is not safe to run. This is why Spec 2 must land before Spec 3 starts.

## Risks and counterpositions

- **Risk: redaction over-applies and masks audit-critical fields.** Mitigation: explicit `must-not-redact` allowlist; signing refuses when these fields are missing post-redaction.
- **Risk: redaction under-applies and leaks PII.** Mitigation: pair with Lattice L0 `regex-deny` rules (Spec 1) that *reject* events containing PII patterns at the governance boundary. Defense in depth — redact AND deny.
- **Risk: chain forking under concurrent writes.** Mitigation: chain writes are serialized per `agent_id` via SQLite transaction. The AuditLog already runs single-process; cross-process coordination is out of scope.
- **Counter: "Why not just use signed git commits as the audit log?"** Considered. Rejected because: SonderEvents fire at sub-second frequency and git commits are too heavy; the chain needs per-agent partitioning that git doesn't model cleanly; we want machine-readable JSON output for downstream consumers. The daily anchor *does* use git, which is the right tool at that frequency.
- **Counter: "Why ed25519 and not RSA / ECDSA?"** Ed25519 is the modern default for new audit systems: deterministic signatures (good for reproducibility), small signatures (64 bytes — manageable as a JSON field), fast verification. No reason to choose otherwise.
- **Counter: "What about the existing `governance.violations` field?"** Unrelated. That field reports validation outcomes from Lattice. The redaction-evidence block lives in a new `metadata.redaction` slot.

## Acceptance criteria

1. `SonderEvent.version === '2'`. Required new fields: `chain_prev_hash`, `chain_self_hash`, `signature`, `metadata.redaction`.
2. `runtime.emit(event)` redacts, hashes, signs, persists, and returns the signed event.
3. `sonder verify-chain --agent-id <id>` walks a chain end-to-end and validates each `chain_self_hash`. Exit 0 on pass; exit 1 with offending event id on mismatch.
4. A v1-schema event passed through `runtime.emit` is auto-upgraded to v2 (chain + signature added). v1 events read from the AuditLog still parse but `verify-chain` skips them.
5. The redaction stage refuses to sign when any `must-not-redact` field is missing post-redaction; error is `RedactionRefusedError('must-not-redact-field-missing:<jsonpath>')`.
6. The anchor script produces a deterministic JSON manifest and tags a commit on the configured public repo.
7. Tests: chain verification under happy path, tampered middle, tampered head, missing event; redaction coverage of common PII (emails, phone, SSN, credit card); end-to-end test that publishes a tiny chain + verifies it from the anchor.
8. Bumps `@heybeaux/sonder-core` to v0.2.0.
9. Documentation: README updated with the publishing flow; new `docs/audit-chain.md` page; example anchor manifest in `examples/anchors/`.

## Cross-spec dependencies

- **Depends on Spec 1 (Lattice L0)** for the regex-deny rules that catch PII at the governance boundary. Spec 2's redaction stage is the second line of defense; Spec 1's L0 is the first.
- **Required by Spec 3 (dogfood loop)**: publishing essays alongside their `sonderevent.ndjson` is unsafe without redaction + chain anchors.

## Migration

- New Sonder deployments: nothing to do; v0.2 generates a chain from event #1.
- Existing deployments with v1 events: the AuditLog reads both versions; `verify-chain` walks only from the first v2 event. Document this as expected; do not attempt to retroactively chain v1 events.
