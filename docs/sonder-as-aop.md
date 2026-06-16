# Sonder → Agent Observation Protocol (AOP)

**Status:** Strategic one-pager / draft for discussion
**Date:** 2026-06-15
**Related:** ADR 0001 (transport out of scope), README "Why It Exists"

## The repositioning

Today Sonder is described as "the event bus that binds six faculties into one cognitive runtime." That's the *implementation*. The bigger claim hiding underneath it: **Sonder defines a standard envelope for what an agent knew, was allowed to do, and why it decided — and that envelope is worth more than any single runtime that emits it.**

The repositioning is to split those two things explicitly:

- **AOP — the spec.** A language-neutral schema + semantic conventions for agent *cognitive* observability. Vendor-agnostic, runtime-agnostic, transport-agnostic. Anyone can emit a conformant event.
- **Sonder — the reference implementation.** The TypeScript in-process bus that produces AOP events from the six faculties (ACR/Engram/Parliament/Lattice/LeWM/AWM).

This is the move that turns Sonder from "our runtime" into "the thing everyone's runtime speaks."

## The wedge

Execution observability is solved and crowded — every platform (LangSmith, Langfuse, Arize Phoenix, AgentOps) instruments timing, tokens, and tool calls. None of them carry structured *cognitive* context: what memory was active, what the agent was permitted to do, what reasoning path was taken, whether a handoff was validated, what outcome was predicted.

That's the layer AOP standardizes. It's a separate concern from execution tracing — an AOP event records *why* an agent did something, not *how fast* it ran. The two can coexist (an AOP event can reference whatever execution trace/span IDs a runtime already emits), but AOP stands on its own: the durable record of agent cognition that nothing else captures.

## Spec / impl split — what actually separates

- **Spec (AOP) owns:** the envelope schema, field semantics ("what does `reasoning.consensus` mean", "how is `prediction.confidence` calibrated"), versioning, conformance levels (e.g. minimal = identity + governance; full = all six faculties), and a JSON Schema / protobuf definition.
- **Sonder (impl) owns:** how events are *produced* — faculty integration, the in-process bus, ULID generation, the query/audit surface, storage. None of that is normative for the spec.

Litmus test: if a Python LangGraph shop can emit a conformant AOP event **without importing a line of Sonder**, the split is real. That's the goal.

## First concrete step: language-neutral envelope schema

The current `SonderEvent` is a TypeScript `interface` — implementation-bound. Step one is lifting it into a neutral, versioned schema that any language can target.

Done — lifted to `aop/schema/v0.1/agent-observation-event.schema.json` (JSON Schema draft 2020-12, the human-readable spec of record) **and** a parallel `agent_observation_event.proto` (proto3) for cross-language codegen and high-volume wire use. The two MUST stay in sync.

Sketch (derived directly from today's `SonderEventCore`, made neutral and versioned — the committed file is the full version):

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://aop.dev/schema/v0.1/agent-observation-event",
  "title": "Agent Observation Event",
  "type": "object",
  "required": ["aop_version", "id", "agent_id", "task_id", "timestamp"],
  "properties": {
    "aop_version": { "const": "0.1" },
    "id":        { "type": "string", "description": "ULID" },
    "agent_id":  { "type": "string" },
    "task_id":   { "type": "string" },
    "parent_id": { "type": "string", "description": "causal chain" },
    "timestamp": { "type": "string", "format": "date-time" },
    "trace_context": {
      "type": "object",
      "description": "Optional link to an external execution trace (trace_id/span_id), if the runtime emits one",
      "properties": { "trace_id": {"type":"string"}, "span_id": {"type":"string"} }
    },
    "capabilities": { "$ref": "#/$defs/capabilities" },
    "memory":       { "$ref": "#/$defs/memory" },
    "reasoning":    { "$ref": "#/$defs/reasoning" },
    "governance":   { "$ref": "#/$defs/governance" },
    "prediction":   { "$ref": "#/$defs/prediction" },
    "intent":       { "$ref": "#/$defs/intent" },
    "payload":  {},
    "metadata": { "type": "object" }
  }
}
```

Two deliberate additions vs. today's interface:
1. **`aop_version`** — the spec is now versioned at the envelope level. Non-negotiable for a standard.
2. **`trace_context`** — optional pointer to an external execution trace, so an AOP event can be correlated with whatever timing/token tracing a runtime already does. Not required to conform.

The six faculty blocks (`$defs`) port over near-verbatim from the real `SonderEventCore` — that's the proof the schema isn't a rewrite, it's a lift. The lift also carries the post-execution fields the README sketch omitted (`outcome`, `resources`, `paths`) and Lattice's policy `evidence`/`tier` and `approval_gate`.

**What the spec deliberately leaves out — and why it matters.** The real `SonderEventV2` carries `chain_prev_hash`, `chain_self_hash`, and `signature` (the tamper-evident hash chain + ed25519 signing). Those are **Sonder-implementation** concerns, *not* normative for AOP — they're how *one* producer makes its log tamper-evident, not part of the observation contract. Drawing that line is the whole point of the spec/impl split: a conformant non-Sonder emitter is not required to chain-and-sign. Sonder may stash those in `metadata` or layer them as an optional AOP signing profile later. Keeping them out of v0.1 is what stops the spec from being "Sonder's serialization format with a new name."

**Conformance tiers** keep adoption cheap: *minimal* requires only identity + `governance`; *standard* adds `memory` + `reasoning`; *full* requires all six. A shop with no Parliament/LeWM equivalent can still emit conformant minimal events.

## Capability-based routing (the second idea)

Worth pursuing, but it's a *Lattice* concern, not an AOP-spec concern — keep them separate so we don't repeat the "don't fold transport into the spec" mistake.

The idea: route a task to a faculty/agent based on declared, resolved capabilities rather than hardcoded wiring. ACR already gives us capability manifests at LOD; Lattice already owns gate policy. Routing is the natural composition: *"given this task's required capability + the State Contract, which mounted faculty is authorized and best-resolved to handle it?"*

This rides cleanly on ADR 0001: the State Contract ≈ A2A Agent Card, so capability-based routing is "match task requirements against Agent Cards, gated by Lattice policy." When it goes cross-host, the routing decision is local; the dispatch rides A2A. **AOP's only role is to *record* the routing decision** (which is arguably a new field — `intent.routing` or a `governance` extension — flag for v0.2). The router lives in Lattice; the spec just observes it.

## Recommended sequence

1. **Lift the schema** — `aop/schema/v0.1/...json`, derived from `SonderEvent`, add `aop_version` + `trace_context`. (Low risk, high signal.)
2. **Make Sonder emit against the schema** — validate `SonderEvent` serialization conforms; Sonder becomes "AOP reference impl."
3. **Conformance tiers doc** — minimal/standard/full, so non-Sonder runtimes have an on-ramp.
4. **Capability-based routing as a Lattice RFC** — separate track, records decisions into AOP but doesn't bloat the envelope.

## Decisions (2026-06-15)

- **Name → AOP (Agent Observation Protocol).** Neutral, infrastructure-flavored name rather than the Sonder brand. Costs nothing now and keeps the land-grab option open without a later rename across schema, proto, and docs.
- **Protobuf → in v0.1.** Shipped alongside the JSON Schema (`agent_observation_event.proto`), signaling serious infra and giving cross-language codegen up front. Accepted cost: two schema sources to keep in sync.

- **Posture → quiet moat.** Ship the impl, prove AOP by *implementing it across our own stack first*, let the spec follow adoption rather than evangelizing a standard with no users. The spec/impl split is kept clean so we can flip to land-grab later without a rewrite — the neutral AOP name and v0.1 protobuf preserve that option at zero cost.

## Where to implement AOP next (credibility-by-dogfooding)

Quiet-moat means the spec earns credibility by being emitted across real heybeaux faculties, not by a launch post. Candidate emitters, each of which proves a different conformance tier:

- **Engram** — emits `memory` blocks (refs, query, confidence, dream_cycle). Proves the KNOWS faculty against a production memory system.
- **Lattice / gate registry** — emits `governance` (contract_id, l1/l2/l3, evidence, approval_gate). Proves the DID faculty and the policy-evidence rows end-to-end.
- **Parliament** — emits `reasoning` (neurotypes, consensus, dissent, osi, rounds). Proves the THINKS faculty from an actual multi-model debate.
- **AWM** — emits `prediction` (Beta alpha/beta confidence). Proves the predictive faculty.
- **ACR** — emits `capabilities` (mounted, resolution by LOD, budget). Proves CAN DO.
- **Factory workers** — emit `intent` + `outcome` per step. Proves WILL DO + post-execution, and gives us a high-volume corpus to validate the protobuf wire path.

A faculty emitting a *conformant minimal AOP event without importing Sonder* is the litmus test from above, made concrete. Each integration is a credibility datapoint; collectively they're the "reference impl" claim earned rather than asserted.
