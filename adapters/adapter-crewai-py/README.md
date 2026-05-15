# sonder-crewai

Sonder cognitive event instrumentation for [CrewAI](https://github.com/joaomdmoura/crewai) workflows.

Every task execution in your crew emits a before+after `SonderEvent` capturing the six cognitive faculties — capabilities, memory, reasoning, governance, prediction, and intent — to a JSONL audit trail.

## Install

```bash
pip install sonder-crewai crewai
```

## Quick start

### Option A — wrap individual tasks

```python
from crewai import Agent, Task
from sonder_crewai import wrap_task, SonderAuditLogger, ReasoningContext, SonderTaskConfig, configure_task

analyst = Agent(role="Analyst", goal="...", backstory="...")

task = configure_task(
    Task(
        description="Analyze the codebase for tech debt",
        agent=analyst,
        expected_output="A prioritized list of debt items",
    ),
    sonder=SonderTaskConfig(
        reasoning=ReasoningContext(model="gpt-4o", neurotypes=["engineering", "critical"]),
    ),
)

audit = SonderAuditLogger("./sonder-audit.jsonl")
wrap_task(task, agent_id="Analyst", task_id="maintenance:0", audit_logger=audit)
```

### Option B — wrap an entire crew

```python
from crewai import Crew, Process
from sonder_crewai import SonderCrewMiddleware

crew = Crew(agents=[...], tasks=[...], process=Process.sequential)

wrapped = SonderCrewMiddleware(
    crew,
    audit_log_path="./sonder-audit.jsonl",
    workflow_id="maintenance:sonder:daily",
)
result = wrapped.kickoff()
```

## API reference

### `wrap_task(task, *, agent_id, task_id, audit_logger, ...)`

Patches a CrewAI `Task` in-place so every execution emits before+after `SonderEvent`s.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `agent_id` | `str` | required | Identifier for the executing agent (usually `agent.role`) |
| `task_id` | `str` | required | Stable identifier for this task within the workflow |
| `audit_logger` | `SonderAuditLogger` | required | JSONL logger to write events to |
| `parent_id` | `str \| None` | `None` | Parent event or task ID for causal chaining |
| `context_factory` | `Callable[[], SonderTaskConfig] \| None` | `None` | Dynamic per-run cognitive context provider |

Returns the same `Task` object (mutated).

### `SonderCrewMiddleware(crew, *, ...)`

Wraps all tasks in a crew automatically. Infers `agent_id` from `task.agent.role`.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `audit_log_path` | `str \| Path` | `"./sonder-audit.jsonl"` | Audit log destination |
| `workflow_id` | `str \| None` | auto ULID | Stable ID for the workflow run |

### `configure_task(task, *, sonder)`

Annotates a task with per-step cognitive context. Call before passing to `SonderCrewMiddleware`.

```python
task = configure_task(Task(...), sonder=SonderTaskConfig(
    capabilities=CapabilityContext(mounted=["read_file", "grep"]),
    reasoning=ReasoningContext(neurotypes=["adversarial"]),
    memory=MemoryContext(refs=["engram:project-context"]),
))
```

### `SonderTaskConfig`

| Field | Type | Description |
|-------|------|-------------|
| `capabilities` | `CapabilityContext \| None` | Mounted tools and budget |
| `memory` | `MemoryContext \| None` | Memory refs and tokens retrieved |
| `reasoning` | `ReasoningContext \| None` | Model, neurotypes, consensus state |
| `governance` | `GovernanceContext \| None` | Contract ID, validation state |
| `prediction` | `PredictionContext \| None` | LeWM confidence distribution |
| `intent` | `IntentContext \| None` | AWM intent and workflow step |
| `metadata` | `dict` | Arbitrary extra fields |

## Audit log format

Each line in the JSONL audit log is a full `SonderEvent`:

```json
{
  "id": "01HNXXXXXXXXXXXXXXXXXXXXXX",
  "version": "1",
  "agentId": "TechDebtInvestigator",
  "taskId": "maintenance:sonder:daily:1:TechDebtInvestigator",
  "parentId": "01HNXXXXXXXXXXXXXXXXXXXXXX",
  "timestamp": "2026-05-12T14:00:00Z",
  "payload": {
    "phase": "before",
    "run_id": "01HNYYYYYYYYYYYYYYYY",
    "description": "Investigate technical debt...",
    "expected_output": "A prioritized list...",
    "agent_role": "TechDebtInvestigator",
    "context": null
  },
  "capabilities": { "mounted": ["read_file", "grep"], "budgetUsed": 0, "budgetLimit": 0 },
  "memory": { "refs": [], "tokensRetrieved": 0 },
  "reasoning": { "model": "", "neurotypes": ["engineering", "critical"], "consensus": true, "dissent": [], "osi": 0.0, "rounds": 1 },
  "governance": { "contractId": "", "validated": true, "l1Pass": true, "l2Pass": true, "l3Pass": true, "violations": [], "circuitState": "closed" },
  "prediction": { "predicted": false, "confidence": 0.0, "alpha": 1.0, "beta": 1.0 },
  "intent": { "intentId": "", "step": "Investigate technical debt...", "workflowId": "maintenance:sonder:daily" },
  "metadata": { "task_id": "...", "agent_id": "TechDebtInvestigator" }
}
```

Each task step produces two lines: one with `"phase": "before"` and one with `"phase": "after"`. The `after` event's `parentId` points to the `before` event's `id`, and both share the same `run_id`.

## Running the example

```bash
cd examples
OPENAI_API_KEY=sk-... python maintenance_crew.py
```

## Running tests

```bash
pip install -e ".[dev]"
pytest tests/
```

## Related

- [lattice-crewai](https://github.com/heybeaux/lattice/tree/main/packages/adapter-crewai) — Lattice State Contract validation layer for CrewAI
- [sonder/core](https://github.com/heybeaux/sonder/tree/main/packages/core) — TypeScript cognitive event bus
- [sonder/sdk](https://github.com/heybeaux/sonder/tree/main/packages/sdk) — TypeScript SDK with `withSonder()` wrapper
