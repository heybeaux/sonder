# Sonder: Agent Cognitive Runtime

## Why

Multi-agent AI systems are failing at the seams. Not because individual models lack capability — empirical research (MAST, Silo-Bench, SEMAP) shows that 41–87% of multi-agent framework failures stem from coordination and integration gaps, not reasoning limitations. The SEMAP study demonstrates that structured handoff protocols reduce coordination failures by 69.6% *without model upgrades*.

The root cause is architectural: each agent component — memory, reasoning, capability management, governance, prediction — solves its problem in isolation. There is no common language, no shared event model, no audit trail that spans the full cognitive cycle. When something goes wrong, there is no way to know what the agent knew, what it was allowed to do, what it predicted, or whether the handoff was valid.

Sonder is the event bus that solves this. It does not replace any existing component. It is the envelope that carries the full cognitive context of every agent action — binding ACR, Engram, Parliament, Lattice, LeWM, and AWM into a coherent runtime.

## What Changes

- Define the **SonderEvent envelope** — a typed, versioned schema that all packages emit and consume
- Publish a lightweight **event bus** that routes events between packages with zero coupling
- Implement **native adapters** for each package in the cognitive stack
- Provide an **audit log** that makes the full cognitive trail queryable
- Ship a **TypeScript SDK** that makes adopting Sonder a one-line integration for any agent framework

## Capabilities

### New Capabilities

- `sonder-event-bus`: Typed event routing between cognitive packages
- `sonder-envelope`: The SonderEvent schema — capability, memory, reasoning, governance, prediction, intent
- `sonder-audit-log`: Persistent, queryable audit trail of every agent event
- `sonder-sdk`: TypeScript SDK for framework-agnostic adoption
- `sonder-adapters`: Native adapters for ACR, Engram, Parliament, Lattice, LeWM, AWM

### Not In Scope

- Replacing or wrapping any existing package's core logic
- Providing agent orchestration (that is Parliament's role)
- Managing deployment or infrastructure
- A UI or dashboard (Engram Dashboard serves that need)

## The Cognitive Stack

Each package answers one question about an agent's cognitive state:

| Faculty | Package | Question |
|---|---|---|
| Can do | ACR | What capabilities are mounted at what resolution? |
| Knows | Engram | What memory was consulted, and with what confidence? |
| Thinks | Parliament | What did deliberation conclude, and was there dissent? |
| Did | Lattice | Was the handoff valid against the state contract? |
| Thinks will happen | LeWM | What outcome is predicted, with what Bayesian confidence? |
| Will do | AWM | What action is planned, and what does the StepTrace show? |

Sonder carries all six answers on every event. This is not overhead — it is the audit trail that makes agentic AI deployable in regulated environments.

## Impact

- New monorepo: `heybeaux/sonder`
- `packages/core` — event bus, envelope schema, audit log
- `packages/sdk` — TypeScript SDK for framework integration
- `adapters/acr` — ACR native adapter
- `adapters/engram` — Engram native adapter
- `adapters/parliament` — Parliament native adapter
- `adapters/lattice` — Lattice native adapter
- `adapters/lewm` — LeWM native adapter
- `adapters/awm` — AWM native adapter

## Success Criteria

- A single Sonder event carries complete cognitive context from all six packages
- Any package can emit or consume events without depending on other packages
- The audit log is queryable by agent ID, task ID, time range, and violation type
- End-to-end latency overhead of the event bus is under 5ms per event (p99)
- A new agent framework can integrate Sonder in under 30 minutes using the SDK
- Lattice + Engram is the first validated integration pair, with a working demo
