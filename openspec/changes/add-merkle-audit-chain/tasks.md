# Tasks: Sonder Audit Chain + Redaction

Order is sequential. Each task is one focused session.

## 1. Lattice prerequisite — extract `redactJson` primitive

- [ ] In `@heybeaux/lattice-core`, extract a `redactJson(tree, { sensitivityLevel, mustNotRedact })` from `redactContract`'s internals.
- [ ] Re-implement `redactContract` on top of `redactJson`. Confirm zero behavior change via existing redact tests.
- [ ] Export `redactJson` from `@heybeaux/lattice-core`.
- [ ] Bump lattice-core minor.

## 2. Schema bump to v2

- [ ] Update `packages/core/src/types/event.ts`: add `chain_prev_hash`, `chain_self_hash`, `signature`, `metadata.redaction`. Bump `version` literal to `'2'`.
- [ ] Add `chain_genesis` table to AuditLog migrations.
- [ ] Add `chain_prev_hash`, `chain_self_hash`, `signature` columns to `events` table with appropriate indexes.

## 3. Canonicalization

- [ ] Implement `packages/core/src/hash.ts` with `canonicalize(value): string` per RFC 8785 JCS.
- [ ] Tests: 30+ JCS golden-vector cases (mostly from the RFC's Appendix B).

## 4. Hashing + signing primitives

- [ ] `hashEvent(event): string` — sha256 of canonicalized event with `chain_self_hash` and `signature` stripped.
- [ ] `chainSelfHash(event)` returning hex.
- [ ] `loadOrGenerateKeypair(path)` — load existing key with `0600` mode check; generate + persist when absent.
- [ ] `sign(event, privateKey)` + `verify(event, publicKey)`.

## 5. Redaction stage

- [ ] `redactSonderEvent(event, { sensitivityLevel, mustNotRedact })` — calls `redactJson` from lattice-core; emits `metadata.redaction`.
- [ ] Default `mustNotRedact` allowlist as defined in `design.md`.
- [ ] Refusal: throw `RedactionRefusedError(`must-not-redact-field-missing:<jsonpath>`)` when any allowlisted path is null/missing post-redaction.

## 6. Genesis + chain write

- [ ] `getOrCreateGenesis(agent_id)` — reads `chain_genesis` table; on first event for agent, writes the genesis row.
- [ ] `readLatestHash(agent_id)` — query the events table for the latest event for that agent.
- [ ] Chain-write helper that takes a redacted event and produces a fully-stamped event ready for signing.

## 7. Runtime emit pipeline

- [ ] Update `runtime.emit` to: redact → enforce must-not-redact → set chain hashes → sign → persist (in `IMMEDIATE` TX) → return signed event.
- [ ] On any failure mid-pipeline: do NOT persist; throw with the originating error.

## 8. AuditLog reads

- [ ] `AuditLog.queryByAgent(agent_id, { from?, limit? })` returning events in `timestamp ASC` order.
- [ ] AuditLog auto-detects v1 vs v2 rows; `query` returns the typed event.
- [ ] Document v1 read behavior: returned as-is, no chain/signature fields.

## 9. Verifier CLI

- [ ] `packages/sdk/src/verify-chain.ts` — programmatic API.
- [ ] `bin/sonder-verify-chain` script registered in `packages/sdk/package.json`.
- [ ] Output formats: human (default) and JSON (`--json`).
- [ ] Exit codes: 0 pass, 1 mismatch, 2 missing data.

## 10. Anchor manifest + publisher

- [ ] `packages/sdk/src/anchor.ts` — manifest builder; pure (no I/O).
- [ ] `bin/sonder-anchor` script — reads AuditLog, builds manifest, writes file to anchor-repo path, `git add`, `git commit`, `git tag`, `git push` with up to 3 retries.
- [ ] Config: `SONDER_ANCHOR_REPO`, `SONDER_ANCHOR_PATH`, `SONDER_ANCHOR_REMOTE` env vars; sensible defaults documented.
- [ ] Idempotent: re-running on the same date overwrites the day's manifest (with a warning) but never produces a duplicate tag.

## 11. Tests

- [ ] **Happy path**: emit 50 events, walk chain, verify all hashes + signatures.
- [ ] **Tampered middle**: flip one byte in event 25's payload; verifier exits 1 at event 25.
- [ ] **Tampered head**: flip one byte in the head event; verifier exits 1 at head.
- [ ] **Missing event**: delete event 10's row; verifier exits 1 with the chain break.
- [ ] **Redaction**: payload contains email + phone + SSN; assert all three are masked in the stored event; assert `metadata.redaction.fields` lists the paths.
- [ ] **Must-not-redact refusal**: configure an `agent_id` redactor that would mask `$.agent_id`; assert `emit` throws.
- [ ] **Cross-version read**: AuditLog with mixed v1 + v2 events; `query` returns both, `verify-chain` skips v1 with a one-line warning.
- [ ] **Concurrent emit**: 10 concurrent `emit` calls for the same agent; verify chain is unforked and ordered.
- [ ] **Anchor manifest**: build a manifest from a fixture chain; assert deterministic JSON output byte-for-byte.

## 12. Documentation

- [ ] `docs/audit-chain.md` — full publishing flow, verifier usage, anchor manifest format.
- [ ] Update `README.md` to reference the v2 schema + verifier CLI.
- [ ] `examples/anchors/example-anchor.json` — sample manifest from the test fixture.
- [ ] Note in `README.md` cross-linking Lattice Spec 1 (L0) as the upstream PII-deny layer.

## 13. Release

- [ ] Bump `@heybeaux/sonder-core` to v0.2.0.
- [ ] Bump `@heybeaux/sonder-sdk` to v0.2.0.
- [ ] CHANGELOG entry; reference the ops report.

## 14. Bootstrap the anchor repo

- [ ] Create `heybeaux/sonder-anchors` (public repo) with a README explaining the anchor manifest format.
- [ ] Configure the runtime's default `SONDER_ANCHOR_REPO` to point at it.
- [ ] First anchor: run manually after first v2 events land; verify externally via `sonder verify-chain --anchor <fetched manifest>`.
