# Spec: Pre-Sign Redaction Stage

## Scope

This spec covers the redaction stage that runs before `chain_self_hash` and `signature` are computed on a SonderEvent. The goal is to make published `sonderevent.ndjson` logs (the dogfood thesis) safe to publish.

## Required behavior

### R1 — Pipeline position

Redaction MUST run as the first step of `runtime.emit`, before any hash or signature is computed. The hashed-and-signed event is the redacted event.

### R2 — Implementation reuse

Redaction MUST reuse `redactJson` from `@heybeaux/lattice-core` v0.4.0+ (exported per Spec 1 R11). Sonder MUST NOT maintain a parallel redaction implementation. Sonder's `package.json` MUST pin `@heybeaux/lattice-core@^0.4.0`; merging Spec 2 with an older Lattice version is a build break by design.

### R3 — Default sensitivity

Default `sensitivityLevel` MUST be `'high'`. Configurable via `runtime.config.redaction.sensitivityLevel`. Downgrading below `'high'` requires explicit configuration.

### R4 — Must-not-redact allowlist

The runtime MUST refuse to sign any event where any path in `mustNotRedact` resolves to null or missing post-redaction.

Default `mustNotRedact`:

```
$.id
$.agent_id
$.task_id
$.timestamp
$.version
$.governance.contract_id
$.governance.validated
$.governance.l1_pass
$.governance.l2_pass
$.governance.l3_pass
$.governance.circuit_state
$.reasoning.consensus
$.reasoning.osi
$.reasoning.rounds
$.intent.action
$.intent.step_trace_id
```

Refusal MUST raise `RedactionRefusedError(`must-not-redact-field-missing:<jsonpath>`)` with the first failing path. The event MUST NOT be persisted.

**Conditional fields:** `$.governance.tier` and `$.governance.evidence` (Spec 1 R7 / Spec 2 R13) are added to `mustNotRedact` IFF `$.governance.tier` resolves on the input. They are optional on v2 events for non-Lattice emitters; the redactor MUST NOT refuse when both are absent. When `tier` is present, both fields MUST survive redaction.

### R5 — Evidence block

Every event MUST carry `metadata.redaction` populated by the redactor:

```ts
{
  fields: string[];                              // JSONPaths of redacted fields
  count: number;                                 // length of fields[]
  sensitivityLevel: 'low' | 'medium' | 'high';
}
```

Always present. `fields = []` and `count = 0` when nothing was redacted.

### R6 — Field paths, not values

`metadata.redaction.fields` MUST list JSONPaths only. The redacted values MUST NOT appear in `metadata.redaction` — that would defeat the purpose.

### R7 — Determinism

For the same input event and the same `redactJson` version, the output MUST be byte-deterministic. Required because the redacted event is what gets hashed and signed.

### R8 — Override safety

Operator-configured `mustNotRedact` additions MUST be additive — operators can ADD paths but not REMOVE the default set. Attempting to remove a default path MUST throw at runtime construction.

### R9 — Interaction with Lattice L0

When Lattice L0 (Spec 1) is in the pipeline upstream of Sonder, the L0 `regex-deny` rules SHOULD catch PII patterns at the governance boundary BEFORE the event reaches Sonder's redactor. This is defense in depth — L0 rejects; redactor masks. Both MAY fire; both produce evidence.

## Non-goals

- Custom redactor implementations inside Sonder.
- Reversible redaction (encryption-with-key-escrow). The redaction is one-way.
- Per-publication redaction profiles (e.g., one redactor for internal storage, another for publication). v0.2 redacts at write time; what is stored is what is published.
- Selective de-redaction for authorized viewers. Out of scope.

## Test coverage requirements

- Email, phone, SSN, credit-card masking at `sensitivityLevel = 'high'`.
- `metadata.redaction.fields` lists the exact JSONPaths of redacted fields.
- `mustNotRedact` refusal: a redactor that would mask `$.agent_id` triggers `RedactionRefusedError`.
- Determinism: same input → same redacted output across 100 iterations.
- Override safety: operator removal of a default `mustNotRedact` entry throws at construction.
