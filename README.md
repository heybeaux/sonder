# Sonder

> *sonder* (n.) — the realization that each passerby has a life as vivid and complex as one's own.

Sonder is the cognitive runtime for AI agents. It is the event bus that binds six independent faculties — capability, memory, reasoning, governance, prediction, and intent — into something that resembles a unified mind.

It does not replace any of its constituent packages. It is the baseplate they snap onto.

---

## The Cognitive Stack

| Faculty | Package | Question answered |
|---|---|---|
| Can do | [ACR](https://github.com/heybeaux/acr) | What tools and capabilities does the agent have access to right now? |
| Knows | [Engram](https://github.com/heybeaux/engram) | What has the agent learned, remembered, and consolidated? |
| Thinks | [Parliament](https://github.com/heybeaux/parliament) | What does multi-model deliberation conclude? |
| Did | [Lattice](https://github.com/heybeaux/lattice) | Were handoffs valid? What did the agent actually do? |
| Thinks will happen | [LeWM](https://github.com/heybeaux/lewm) | What outcomes does the agent predict? |
| Will do | [AWM](https://github.com/heybeaux/awm) | What action is the agent about to take, optimized by prior outcomes? |

Sonder is the envelope that carries all six answers on every agent event.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Agent Runtime                        │
│                          (Sonder)                           │
│                                                             │
│   ┌──────────┐   ┌──────────┐   ┌──────────┐              │
│   │  ACR     │   │  Engram  │   │Parliament │              │
│   │ Can Do   │   │  Knows   │   │  Thinks   │              │
│   └────┬─────┘   └────┬─────┘   └────┬──────┘              │
│        │              │              │                       │
│        └──────────────┴──────────────┘                      │
│                       │                                     │
│              ┌────────▼────────┐                            │
│              │  Event Envelope │  ◄── the nervous system    │
│              └────────┬────────┘                            │
│                       │                                     │
│        ┌──────────────┴──────────────┐                      │
│        │              │              │                       │
│   ┌────▼─────┐   ┌────▼─────┐   ┌───▼──────┐              │
│   │ Lattice  │   │  LeWM    │   │   AWM    │              │
│   │   Did    │   │Predicts  │   │ Will Do  │              │
│   └──────────┘   └──────────┘   └──────────┘              │
└─────────────────────────────────────────────────────────────┘
```

---

## The Event Envelope

Every agent action in Sonder emits a structured event. The envelope is the common language all packages speak:

```typescript
interface SonderEvent {
  id: string;                    // ULID — sortable, unique
  agent_id: string;              // stable identity across sessions
  task_id: string;               // groups related events
  timestamp: string;             // ISO 8601

  // ACR: capability context
  capabilities: {
    mounted: string[];           // active capability IDs
    resolution: Record<string, 'index' | 'summary' | 'standard' | 'deep'>;
  };

  // Engram: memory context
  memory: {
    refs: string[];              // memory IDs consulted
    confidence: number;          // 0–1 retrieval confidence
  };

  // Parliament: reasoning context
  reasoning: {
    model: string;               // model that produced this action
    consensus: boolean;          // did deliberation reach consensus?
    dissent: string[];           // dissenting neurotype IDs if any
  };

  // Lattice: governance context
  governance: {
    contract_id: string;         // state contract that governed this handoff
    validated: boolean;          // did L1/L2/L3 pass?
    violations: string[];        // validation failure codes
  };

  // LeWM: prediction context
  prediction: {
    outcome: string;             // predicted outcome label
    confidence: number;          // 0–1 Bayesian confidence
  };

  // AWM: intent context
  intent: {
    action: string;              // the action being taken
    step_trace_id: string;       // AWM StepTrace reference
    skip_reason?: string;        // if step was skipped on high confidence
  };

  payload: unknown;              // the actual event data
}
```

---

## Why This Matters

Multi-agent systems fail silently. A single failed handoff can cascade across a pipeline with no audit trail, no explanation, and no way to diagnose root cause. Enterprises cannot deploy agents at scale when they cannot answer:

- *Why did the agent make that decision?*
- *What did it know when it acted?*
- *Was the handoff valid?*
- *What did it predict, and was it right?*

The Sonder envelope answers all four questions on every event. That is not just a developer convenience — it is an enterprise compliance story.

---

## Status

Early design phase. See [`openspec/changes/sonder-agent-runtime/`](./openspec/changes/sonder-agent-runtime/) for the full proposal, design, and implementation roadmap.

---

## OpenSpec

This project uses [OpenSpec](https://github.com/Fission-AI/OpenSpec) for change documentation.
