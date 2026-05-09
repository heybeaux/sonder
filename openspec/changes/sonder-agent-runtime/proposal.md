# Sonder: Agent Cognitive Runtime

## Why

Multi-agent AI systems are failing at the seams. Not because individual models lack capability — empirical research shows that the majority of failures stem from coordination and integration gaps, not reasoning limitations. Cemri et al. (2025) analyzed 1,600+ annotated execution traces across 7 multi-agent frameworks and found that approximately 79% of failures are coordination-related: specification and design gaps (~42%) and inter-agent misalignment (~37%), versus only ~21% attributable to base-model reasoning failures. State-of-the-art open-source systems like ChatDev achieve only 25% baseline correctness. A companion study found production failure rates of 41–87% across deployed multi-agent systems, with coordination defects as the dominant attribution. The SEMAP study demonstrates that structured handoff protocols reduce coordination failures by 69.6% *without model upgrades*.

The root cause is architectural: each agent component — memory, reasoning, capability management, governance, prediction — solves its problem in isolation. There is no common language, no shared event model, no audit trail that spans the full cognitive cycle. When something goes wrong, there is no way to know what the agent knew, what it was allowed to do, what it predicted, or whether the handoff was valid.

Sonder is the event bus that solves this. It does not replace any existing component. It is the envelope that carries the full cognitive context of every agent action — binding ACR, Engram, Parliament, Lattice, LeWM, and AWM into a coherent runtime.

## Theoretical Foundation

Sonder is a computational instantiation of Global Workspace Theory (Baars, 1988) for LLM-era agents. GWT proposes that consciousness functions as a shared broadcast medium: specialized processors compete for access to a central global workspace, and when content is broadcast, it becomes available to all modules simultaneously. Sonder's per-action event envelope is that broadcast — every agent action carries context from all six cognitive faculties, making it universally available for audit, reaction, and downstream processing.

The Memory/Parliament/AWM triad extends the well-established BDI architecture (Rao & Georgeff, 1995): Beliefs → Engram, practical reasoning → Parliament, Intentions → AWM. Sonder's contribution is extending this triad with two first-class additions absent from every classical cognitive architecture (ACT-R, SOAR, LIDA, OpenCog) and from the CoALA framework (Sumers et al., 2023): **Governance/Lattice** as a co-equal cognitive faculty contributing to every action, and **Prediction/LeWM** as explicit forward modeling before action selection.

## Regulatory Context

The compliance case for Sonder is not hypothetical — it is regulatory mandate.

**EU AI Act (Articles 12 & 19) — effective August 2, 2026**: High-risk AI systems must maintain automatic logs sufficient to identify risk-presenting situations, enable post-market monitoring, and reconstruct the context of decisions on regulatory demand. Penalties up to €15M or 3% of global annual turnover. Any enterprise deploying high-risk AI in the EU without a compliant cognitive audit log is in an active compliance gap today.

**ESMA Supervisory Briefing (February 2026)**: MiFID II firms must be able to explain how AI impacts algorithm decisions to supervisors on demand. RTS 6 requires time-sequenced records stored for 5 years with sufficient detail for regulatory examination.

**FINRA 2026 Annual Regulatory Oversight Report**: Explicitly flags that "complicated, multi-step agent reasoning tasks can make outcomes difficult to trace or explain, complicating auditability." Firms must be able to reconstruct the chain of reasoning an agent used if a trade or communication is flagged.

**HIPAA (45 CFR 164.312(b))**: Each discrete AI action in a healthcare workflow requires its own timestamp, data scope, and justification. Confidence scores, model version, and human reviewer identifications must be logged. Retention: 6 years minimum.

**NAIC Model AI Bulletin (2023)**: Adopted by 23 states. Requires explainable AI decisions in insurance, with audits and validation documentation.

The five questions these regulations collectively require answers to — and which no existing observability tool provides:

1. What did the agent know when it acted? → `memory.refs` (Engram)
2. What was it authorized to do? → `capabilities.mounted` (ACR)
3. Why did it decide what it decided? → `reasoning.*` (Parliament)
4. Was the handoff governance-validated? → `governance.validated` (Lattice)
5. What outcome did it predict? → `prediction.*` (LeWM)

Existing observability platforms (LangSmith, Langfuse, Arize Phoenix, AgentOps) answer none of these. They capture what the agent did at the operational layer — timing, tokens, tool calls. The OpenTelemetry GenAI SIG explicitly defers cognitive context fields to the application layer as out of scope for the standard itself. Sonder is that application layer, made infrastructure.

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

## References

- Cemri et al. (2025). "Why Do Multi-Agent LLM Systems Fail?" UC Berkeley Sky Lab. arXiv:2503.13657
- Cemri et al. (2025). "Coordination as an Architectural Layer." arXiv:2605.03310
- Kim et al. (2025). "Towards a Science of Scaling Agent Systems." DeepMind. arXiv:2512.08296
- Sumers et al. (2023). "Cognitive Architectures for Language Agents (CoALA)." arXiv:2309.02427
- Baars, B.J. (1988). *A Cognitive Theory of Consciousness*. Cambridge University Press.
- Rao & Georgeff (1995). "BDI Agents: From Theory to Practice." *Proceedings of ICMAS-95*.
- EU AI Act Article 12: https://artificialintelligenceact.eu/article/12/
- ESMA Supervisory Briefing (Feb 2026): https://www.esma.europa.eu/sites/default/files/2026-02/ESMA74-1505669079-10311_Supervisory_Briefing_on_Algorithmic_Trading_in_the_EU.pdf
