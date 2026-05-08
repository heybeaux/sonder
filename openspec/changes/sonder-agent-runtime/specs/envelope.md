# Spec: SonderEvent Envelope

## Overview

The SonderEvent envelope is the atomic unit of the Sonder runtime. Every agent action emits exactly one event. The envelope carries the full cognitive context from all six packages in the stack.

## Acceptance Criteria

- Every SonderEvent has a unique, lexicographically sortable ID (ULID)
- Every SonderEvent has a stable agent_id and a task_id that groups related events
- Every SonderEvent carries typed sections for all six cognitive faculties
- The envelope schema is versioned; breaking changes bump the version field
- An event with missing adapter sections is valid — sections default to null/empty rather than blocking emission
- The envelope is serializable to JSON with no loss of fidelity

## Scenarios

### Given a mounted ACR capability, when an event is emitted

```
Given: ACR has mounted capability "web-search" at "standard" resolution (1,250 tokens)
When:  The agent emits a SonderEvent
Then:  event.capabilities.mounted contains "web-search"
       event.capabilities.resolution["web-search"] === "standard"
       event.capabilities.budget_used reflects the actual token consumption
```

### Given an Engram memory retrieval, when an event is emitted

```
Given: Engram retrieved memory records ["mem_01", "mem_02"] with ensemble confidence 0.87
When:  The agent emits a SonderEvent
Then:  event.memory.refs === ["mem_01", "mem_02"]
       event.memory.confidence === 0.87
```

### Given a Parliament deliberation with dissent, when an event is emitted

```
Given: Parliament deliberated with neurotypes [Proposer, Skeptic, Empiricist]
       Skeptic dissented after 3 rounds; no consensus reached
When:  The agent emits a SonderEvent
Then:  event.reasoning.consensus === false
       event.reasoning.dissent contains "Skeptic"
       event.reasoning.rounds === 3
       event.reasoning.osi > 0  (opinion shift detected)
```

### Given a Lattice StateContract validation failure, when an event is emitted

```
Given: Lattice StateContract "handoff-v1" requires output.result to be a string
       Agent produced output.result as null
When:  The agent emits a SonderEvent
Then:  event.governance.validated === false
       event.governance.l1_pass === false
       event.governance.violations contains "L1_TYPE_MISMATCH"
       event.governance.circuit_state === "open"
```

### Given a LeWM prediction, when an event is emitted

```
Given: LeWM predicts outcome "success" with Beta(42, 8) distribution
       Bayesian mean: 42 / (42 + 8) = 0.84
When:  The agent emits a SonderEvent
Then:  event.prediction.outcome === "success"
       event.prediction.confidence === 0.84
       event.prediction.alpha === 42
       event.prediction.beta === 8
```

### Given an AWM step skip on high confidence, when an event is emitted

```
Given: AWM predicted outcome confidence > 0.95 threshold
       Step "validate-output" was pre-confirmed via approval gate
When:  The agent emits a SonderEvent
Then:  event.intent.skipped === true
       event.intent.skip_reason contains the confidence threshold justification
       event.intent.constraint_injected === true
```

### Given no Engram adapter is registered, when an event is emitted

```
Given: Sonder is configured with only ACR and Lattice adapters
When:  The agent emits a SonderEvent
Then:  event.memory.refs === []
       event.memory.confidence === 0
       Event emission succeeds — missing adapters do not block
```

## Non-Functional Requirements

| Requirement | Target |
|---|---|
| Envelope serialization | JSON, < 4KB for typical event |
| ULID generation | < 0.1ms |
| Schema validation on emit | Optional (dev mode on, prod mode off by default) |
| Backwards compatibility | Additive changes only within a version; new version for breaking changes |

## Example Payload

```json
{
  "id": "01HWXK3P9Q7NMVR5T2B8C6D4EF",
  "version": "1",
  "agent_id": "agent_forge_linkedin_01",
  "task_id": "task_draft_post_2026_05_08",
  "parent_id": "01HWXK3P9Q2ABCDEFGHIJKLMNO",
  "timestamp": "2026-05-08T16:31:00.000Z",
  "capabilities": {
    "mounted": ["web-search", "content-writer"],
    "resolution": {
      "web-search": "standard",
      "content-writer": "deep"
    },
    "budget_used": 3750,
    "budget_limit": 8000
  },
  "memory": {
    "refs": ["mem_01HWXK1A", "mem_01HWXK2B"],
    "query": "LinkedIn post drafting guidelines tone of voice",
    "confidence": 0.91,
    "dream_cycle": null
  },
  "reasoning": {
    "model": "anthropic/claude-sonnet-4-6",
    "neurotypes": ["Proposer", "Skeptic", "Synthesizer"],
    "consensus": true,
    "dissent": [],
    "osi": 0.12,
    "rounds": 2
  },
  "governance": {
    "contract_id": "contract_linkedin_draft_v2",
    "validated": true,
    "l1_pass": true,
    "l2_pass": true,
    "l3_pass": true,
    "violations": [],
    "circuit_state": "closed"
  },
  "prediction": {
    "outcome": "approved",
    "confidence": 0.88,
    "alpha": 44,
    "beta": 6,
    "model_id": "lewm_content_approval_v1"
  },
  "intent": {
    "action": "draft_linkedin_post",
    "step_trace_id": "trace_01HWXK3P9Q",
    "skipped": false,
    "constraint_injected": false
  },
  "payload": {
    "input": "Draft a LinkedIn post about the Sonder release",
    "output": "Today we're open-sourcing Sonder..."
  }
}
```
