# Design: Sonder Audit Chain + Redaction

## Pipeline order

```
emit(event)
  → redact(event)               // step 1: PII masking
  → enforce(must-not-redact)    // step 2: refuse if audit-critical fields gone
  → hash(redacted, prev_hash)   // step 3: chain hashes
  → sign(redacted + hashes)     // step 4: ed25519
  → persist                     // step 5: AuditLog INSERT (TX-serialized per agent_id)
  → return signed event
```

Any step's failure short-circuits the pipeline. The function `runtime.emit` is the only public surface; the steps are not individually exposed.

## Where the code lives

- `packages/core/src/redact.ts` (new) — thin wrapper around `redactContract` from `@heybeaux/lattice-core` that adapts a `SonderEvent` shape to the redactor's `StateContract`-shaped input. (Or: declare a redactor type that both accept and call directly.)
- `packages/core/src/hash.ts` (new) — `canonicalize`, `hashEvent`, `chainSelfHash` pure functions.
- `packages/core/src/sign.ts` (new) — ed25519 keypair load/generate, sign, verify.
- `packages/core/src/audit.ts` — extended to persist `chain_prev_hash`, `chain_self_hash`, `signature` columns and to serialize chain writes per `agent_id`.
- `packages/core/src/types/event.ts` — schema bump to v2.
- `packages/core/src/runtime.ts` (or wherever `emit` lives) — orchestrate the 5-step pipeline.
- `packages/sdk/src/verify-chain.ts` (new) — CLI verifier exposed as `bin/sonder-verify-chain` in `package.json`.
- `packages/sdk/src/anchor.ts` (new) — anchor manifest writer (the cron script).
- `examples/anchors/example-anchor.json` (new) — sample manifest.

## Canonicalization

Canonical JSON for hashing follows [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) (JCS):

- UTF-8.
- Object keys sorted lexicographically.
- No whitespace.
- Numbers per ECMA-262 (no `1.0` vs `1` divergence).
- Strings: minimum escaping; no `\u`-encoded ASCII.

`canonicalize(event)` is the only canonicalization used for both `chain_self_hash` and `signature` payload computation. They MUST agree byte-for-byte.

## Hash computation

```ts
chain_self_hash = hex(sha256(canonicalize(event_without_chain_self_hash_or_signature)))
```

The `signature` field is computed AFTER `chain_self_hash` is set, over the full canonicalized event (with `chain_self_hash` present, `signature` absent). So:

1. Build event with `chain_prev_hash` set, `chain_self_hash` absent, `signature` absent.
2. Set `chain_self_hash = hex(sha256(canonicalize(event_v1)))`.
3. Set `signature = base64(ed25519_sign(canonicalize(event_v1_with_self_hash)))`.

Verification:

1. Strip `signature`. Recompute the ed25519 verification target = `canonicalize(stripped)`. Verify.
2. Strip `chain_self_hash` and `signature`. Recompute `sha256(canonicalize(stripped))`. Compare to stored `chain_self_hash`. Verify.

This makes verification a pure function of the persisted event — no secrets needed.

## Genesis seed

For the first event of an agent's chain:

```ts
chain_prev_hash = `genesis:${agent_id}:${chain_genesis_iso8601}`
```

Where `chain_genesis_iso8601` is the timestamp of the first event for this agent. Recorded in a small `chain_genesis` table:

```sql
CREATE TABLE chain_genesis (
  agent_id TEXT PRIMARY KEY,
  genesis_event_id TEXT NOT NULL,
  genesis_timestamp TEXT NOT NULL
);
```

Why this format: clean human-readable seed; no risk of seed collision with a `sha256` output (the prefix `genesis:` is invalid hex); easy to grep.

## Concurrency

Writes are serialized per-agent via SQLite `IMMEDIATE` transactions on the events table. Pseudocode:

```ts
db.transaction(() => {
  const prevHash = readLatestHash(agent_id) ?? genesisFor(agent_id);
  event.chain_prev_hash = prevHash;
  event.chain_self_hash = hash(event);
  event.signature = sign(event);
  insertEvent(event);
}).immediate();
```

If two `emit` calls race for the same agent, SQLite serializes them; the second call sees the first's `chain_self_hash` as its `chain_prev_hash`. No fork.

Cross-process (multi-Sonder-instance writing to the same DB) is out of scope; deployments that need it MUST front the AuditLog with a single-writer process.

## Redaction integration

`redactContract` from `@heybeaux/lattice-core` operates on `StateContract`. SonderEvent is not a StateContract. Two options:

- **(A)** Adapt: build a `StateContract`-shaped façade around `SonderEvent.payload + .metadata`, redact, copy back.
- **(B)** Promote: refactor `redactContract` to accept a generic JSON tree + sensitivity config.

Decision: **(B)**, but in a backward-compatible way. Extract a `redactJson(tree, { sensitivityLevel, mustNotRedact })` primitive from `redactContract`. Re-implement `redactContract` on top of it. Sonder calls `redactJson` directly.

The Lattice side change is a small refactor; the public `redactContract` signature does not change.

### `mustNotRedact` allowlist

Default set (overridable via `runtime.config.redaction.mustNotRedact`):

```ts
[
  '$.id',
  '$.agent_id',
  '$.task_id',
  '$.timestamp',
  '$.version',
  '$.governance.contract_id',
  '$.governance.validated',
  '$.governance.l1_pass',
  '$.governance.l2_pass',
  '$.governance.l3_pass',
  '$.governance.circuit_state',
  '$.reasoning.consensus',
  '$.reasoning.osi',
  '$.reasoning.rounds',
  '$.intent.action',
  '$.intent.step_trace_id',
]
```

If any allowlisted path is null/missing after redaction, signing refuses. Sets a hard floor on the metadata required for an audit-useful event.

## Signing key management

- **Generation**: ed25519 keypair generated by `runtime` on first start. Persisted to `~/.sonder/key` (JSON: `{ privateKey: base64, publicKey: base64, createdAt: iso8601 }`).
- **Permissions**: file created with mode `0600`. Runtime refuses to start if mode is more permissive.
- **Path override**: `SONDER_KEY_PATH` env var.
- **Public key surfacing**: `runtime.publicKey` getter returns the base64 public key. Used by anchor manifests and external verifiers.
- **No rotation in v0.2**: a fresh key means a fresh chain. Documented.

## Anchor manifest

```ts
interface AnchorEntry {
  agent_id: string;
  chain_head: string;        // hex of latest chain_self_hash
  head_event_id: string;
  head_timestamp: string;    // ISO8601 of the head event
  anchored_at: string;       // ISO8601 of anchor creation
  public_key: string;        // base64 ed25519 public key
}

interface AnchorManifest {
  version: '1';
  generated_at: string;      // ISO8601
  entries: AnchorEntry[];
}
```

The anchor script:

1. Reads latest `chain_self_hash` per agent from the AuditLog.
2. Constructs the `AnchorManifest`.
3. Writes to `<configured-anchor-repo>/anchors/<YYYY-MM-DD>.json`.
4. Commits with message `anchor: <YYYY-MM-DD> (<n> agents)`.
5. Tags `anchor-<YYYY-MM-DD>`.
6. Pushes.

The push step is the only non-deterministic external dependency; failures retry with backoff up to 3 times before bailing out (the anchor for the day can be re-run).

## Verifier CLI

```
sonder verify-chain --agent-id <id> [--from <event_id>] [--anchor <path>] [--db <path>]
```

Behavior:

1. Open AuditLog at `--db` (default `~/.sonder/audit.db`).
2. Walk events for `agent_id` in `timestamp ASC` order from `--from` (default: the genesis event).
3. For each event:
   - Recompute `chain_self_hash`. Compare to stored. Mismatch → exit 1.
   - Recompute signature. Verify against `--public-key` (default: AuditLog's recorded public key for this agent). Mismatch → exit 1.
   - Confirm `event.chain_prev_hash` matches the previous event's `chain_self_hash`. Mismatch → exit 1.
4. If `--anchor` provided, walk forward until reaching the event whose `chain_self_hash` matches the anchor's `chain_head`. Confirm the anchor entry matches.
5. Exit 0 with a summary: `verified <n> events from <first_id> to <last_id> (anchor: <date> head: <head_id>)`.

## Schema bump (v1 → v2)

```ts
export interface SonderEvent {
  // ... existing v1 fields ...
  version: '2';

  // NEW
  chain_prev_hash: string;
  chain_self_hash: string;
  signature: string;

  metadata?: Record<string, unknown> & {
    redaction?: {
      fields: string[];
      count: number;
      sensitivityLevel: 'low' | 'medium' | 'high';
    };
  };
}
```

v1 events in storage remain readable; their `version` field stays `'1'` and they have no chain/signature. The verifier skips v1 events with a one-line warning.

## What this does NOT do

- Does not change the `governance` block (Spec 1 owns that).
- Does not encrypt payloads at rest.
- Does not rotate keys.
- Does not provide selective disclosure / ZK-proof of membership.
- Does not anchor to anything other than a git tag on a public repo.

## Open questions deferred to implementation

- Should the verifier support parallel verification across agents? Probably yes; trivial via `Promise.all`. Add behind a `--parallel` flag.
- Should `runtime.emit` be batched (write N events in one TX)? Marginal performance gain; defer.
- Should the anchor manifest include the SHA of the entire AuditLog SQLite file? Adds a second integrity dimension; defer to v0.3.
