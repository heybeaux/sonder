# Spec: Audit Chain

## Scope

This spec covers the per-agent Merkle hash chain over the SonderEvent audit log: hash format, signing, persistence, verification, and daily public anchoring.

## Required behavior

### R1 — Schema v2 fields

`SonderEvent.version === '2'` events MUST include three new top-level fields:

- `chain_prev_hash: string`
- `chain_self_hash: string`
- `signature: string`

v1 events remain valid for storage and query; the verifier skips them with a warning.

### R2 — Hash formula

`chain_self_hash = lowercase_hex(sha256(canonicalize(event)))` where:

- `event` has `chain_self_hash` and `signature` fields removed before canonicalization.
- `canonicalize` follows RFC 8785 JCS (UTF-8, sorted keys, no whitespace, ECMA-262 number formatting, minimal string escaping).

### R3 — Signature formula

`signature = base64(ed25519_sign(canonicalize(event)))` where:

- `event` has `signature` removed but `chain_self_hash` PRESENT.
- The same canonicalization as R2.

The signature is computed AFTER `chain_self_hash` is set. Verification reverses this: strip `signature`, recompute the canonicalized event, verify against the public key.

### R4 — Genesis seed

For the first event of an `agent_id`, `chain_prev_hash` MUST equal `'genesis:' + agent_id + ':' + iso8601_timestamp_of_first_event`. The genesis tuple MUST be persisted in a `chain_genesis(agent_id, genesis_event_id, genesis_timestamp)` table.

### R5 — Chain integrity invariant

For every pair of events `(e_n, e_{n+1})` for the same `agent_id` ordered by `timestamp ASC`:

```
e_{n+1}.chain_prev_hash === e_n.chain_self_hash
```

The verifier MUST exit non-zero with the offending event id when this invariant fails.

### R6 — Concurrency

Chain writes for the same `agent_id` MUST be serialized via SQLite `IMMEDIATE` transactions. Concurrent `emit` calls produce a linear chain with no fork.

Cross-process writes to the same AuditLog are NOT supported in v0.2. Deployments needing this MUST front the AuditLog with a single-writer process.

### R7 — Verifier behavior

The CLI `sonder verify-chain --agent-id <id>` MUST:

1. Walk events in `timestamp ASC`.
2. For each event: recompute `chain_self_hash`; recompute signature; assert `chain_prev_hash` matches predecessor's `chain_self_hash`.
3. Exit 0 on full pass with a one-line summary including count and head event id.
4. Exit 1 on first mismatch with the offending event id and the failed check.
5. Exit 2 on missing data (e.g., no events for the agent).

The verifier MUST NOT mutate the AuditLog.

### R8 — Anchor manifest

The daily anchor manifest MUST conform to:

```ts
{
  version: '1',
  generated_at: iso8601,
  entries: [
    {
      agent_id: string,
      chain_head: string,        // hex chain_self_hash of the head event
      head_event_id: string,
      head_timestamp: iso8601,
      anchored_at: iso8601,
      public_key: base64,        // ed25519 public key
    }
  ]
}
```

The manifest MUST be byte-deterministic for a given input chain state.

### R9 — Anchor publication

The anchor publisher MUST:

1. Write the manifest JSON to the configured anchor-repo path.
2. `git add`, `git commit -m 'anchor: <YYYY-MM-DD> (<n> agents)'`, `git tag anchor-<YYYY-MM-DD>`.
3. `git push` with up to 3 retries on transient failures.
4. Be idempotent on same-day re-runs: overwrite the manifest, advance the tag, surface a warning.

### R10 — Key management

The runtime ed25519 keypair MUST be:

- Generated on first start if absent.
- Persisted to a file with mode `0600`.
- Loadable on subsequent starts.
- Surface its public component via `runtime.publicKey: string` (base64).

The runtime MUST refuse to start if the key file exists with mode more permissive than `0600`.

### R11 — Schema version skew

When the AuditLog contains a mix of v1 and v2 events:

- `query` returns both, typed by their `version` field.
- `verify-chain` walks only events where `version === '2'`. Encountering a v1 event mid-walk emits one warning line and continues (not a chain break).
- The chain genesis for an agent is the first v2 event for that agent.

### R12 — L0 evidence enforcement at sign time

The runtime MUST refuse to compute `chain_self_hash` or `signature` for any event whose `governance.tier` references `'L1'`, `'L2'`, or `'L3'` and whose `governance.evidence` is empty or absent. Refusal MUST raise `SignRefusedError('l0-evidence-missing')` BEFORE hashing.

This implements Spec 1 (Lattice L0) R7 on the Sonder side. The check runs after redaction (so PII is already masked) but before hash/sign — the event is dropped, not persisted, and the chain does not advance.

Events whose `governance.tier` is `'L0'`-only OR is absent (e.g., non-Lattice emitters during v0.2 migration) MUST be allowed through this check. The check fires only when L1/L2/L3 is claimed without corresponding evidence.

### R13 — Governance schema (v2)

`SonderEvent.governance` in v2 events MUST include all v1 fields PLUS two optional fields:

- `tier?: string` — `+`-joined list of Lattice tiers that produced evidence (e.g., `'L0'`, `'L0+L1'`, `'L0+L1+L2'`). Absent for non-Lattice emitters.
- `evidence?: PolicyEvidenceRow[]` — L0 per-rule evidence, shape re-exported from `@heybeaux/lattice-core`. Sonder MUST NOT redefine this type.

When `tier` is set, the `mustNotRedact` allowlist applies to both `$.governance.tier` and `$.governance.evidence`. When `tier` is absent, both fields MAY be missing without triggering refusal.

## Non-goals

- Cross-agent chain linkage.
- Key rotation.
- Hardware-backed signing.
- Encrypted-at-rest payloads.
- Anchoring to blockchains, Sigstore, or other transparency systems.
- Selective disclosure / zero-knowledge membership proofs.

## Test coverage requirements

- Happy path (50-event chain, end-to-end verify).
- Tampered payload at middle event.
- Tampered head event.
- Deleted middle event.
- Concurrent emit (10 parallel calls, same agent).
- Manifest determinism (same input → same byte-for-byte output).
- Key-permissions refusal (chmod 0644 → runtime refuses start).
- Cross-version read (mixed v1/v2 AuditLog).
