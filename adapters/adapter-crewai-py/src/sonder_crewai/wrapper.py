from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Callable

from crewai import Task
from ulid import ULID

from .audit import SonderAuditLogger
from .event import (
    CapabilityContext,
    GovernanceContext,
    IntentContext,
    MemoryContext,
    PredictionContext,
    ReasoningContext,
    SonderEvent,
)


@dataclass
class SonderTaskConfig:
    """Per-task cognitive context overrides injected before each step."""
    capabilities: CapabilityContext | None = None
    memory: MemoryContext | None = None
    reasoning: ReasoningContext | None = None
    governance: GovernanceContext | None = None
    prediction: PredictionContext | None = None
    intent: IntentContext | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


def configure_task(task: Any, *, sonder: SonderTaskConfig | None = None, **kwargs: Any) -> Any:
    """Annotate a CrewAI Task with per-step Sonder configuration.

    Call before passing the crew to SonderCrewMiddleware.

        task = configure_task(Task(...), sonder=SonderTaskConfig(reasoning=ReasoningContext(model="gpt-4o")))
    """
    # Store on __dict__ to survive Pydantic's strict field validation
    object.__setattr__(task, "_sonder_config", sonder or SonderTaskConfig(**kwargs))
    return task


class SonderTask(Task):
    """CrewAI Task subclass that emits Sonder events on each execution."""

    model_config = {"arbitrary_types_allowed": True}

    _sonder_agent_id: str = ""
    _sonder_task_id: str = ""
    _sonder_parent_id: str | None = None
    _sonder_audit: Any = None  # SonderAuditLogger
    _sonder_context_factory: Any = None  # Callable[[], SonderTaskConfig] | None
    _sonder_wrapped: bool = False

    def execute_sync(
        self,
        agent: Any = None,
        context: str | None = None,
        tools: list | None = None,
    ) -> Any:
        agent_id = self._sonder_agent_id
        task_id = self._sonder_task_id
        audit_logger: SonderAuditLogger = self._sonder_audit
        parent_id = self._sonder_parent_id

        # Resolve cognitive config
        raw_config = object.__getattribute__(self, "__dict__").get("_sonder_config")
        if not isinstance(raw_config, SonderTaskConfig):
            factory = self._sonder_context_factory
            raw_config = factory() if callable(factory) else SonderTaskConfig()
        config: SonderTaskConfig = raw_config

        run_id = str(ULID())

        before_event = SonderEvent(
            agent_id=agent_id,
            task_id=task_id,
            parent_id=parent_id,
            payload={
                "phase": "before",
                "run_id": run_id,
                "description": self.description,
                "expected_output": self.expected_output,
                "agent_role": getattr(agent or self.agent, "role", agent_id),
                "context": context,
            },
            capabilities=config.capabilities or CapabilityContext(),
            memory=config.memory or MemoryContext(),
            reasoning=config.reasoning or ReasoningContext(),
            governance=config.governance or GovernanceContext(),
            prediction=config.prediction or PredictionContext(),
            intent=config.intent or IntentContext(step=self.description[:80], workflow_id=task_id),
            metadata={"task_id": task_id, "agent_id": agent_id, **config.metadata},
        )
        audit_logger.log(before_event)

        t0 = time.monotonic()
        output = super().execute_sync(agent=agent, context=context, tools=tools)
        wall_ms = int((time.monotonic() - t0) * 1000)

        after_event = SonderEvent(
            agent_id=agent_id,
            task_id=task_id,
            parent_id=before_event.id,
            payload={
                "phase": "after",
                "run_id": run_id,
                "raw": getattr(output, "raw", str(output)),
                "agent_role": getattr(agent or self.agent, "role", agent_id),
                "wall_ms": wall_ms,
            },
            capabilities=config.capabilities or CapabilityContext(),
            memory=config.memory or MemoryContext(),
            reasoning=config.reasoning or ReasoningContext(),
            governance=config.governance or GovernanceContext(),
            prediction=config.prediction or PredictionContext(),
            intent=config.intent or IntentContext(step=self.description[:80], workflow_id=task_id),
            metadata={"task_id": task_id, "agent_id": agent_id, "wall_ms": wall_ms, **config.metadata},
        )
        audit_logger.log(after_event)

        return output


def wrap_task(
    task: Any,
    *,
    agent_id: str,
    task_id: str,
    audit_logger: SonderAuditLogger,
    parent_id: str | None = None,
    context_factory: Callable[[], SonderTaskConfig] | None = None,
) -> SonderTask:
    """Convert a plain CrewAI Task into a SonderTask.

    Uses model_copy() + __class__ reassignment so Pydantic validation is
    preserved while giving us the SonderTask.execute_sync override.
    The original task object is not mutated.
    """
    if isinstance(task, SonderTask):
        return task

    # Carry over any sonder config that was set via configure_task
    existing_config = task.__dict__.get("_sonder_config")

    # model_copy preserves all Pydantic-validated fields; class reassignment
    # converts it to SonderTask without re-running validation
    sonder_task: SonderTask = task.model_copy()
    sonder_task.__class__ = SonderTask

    object.__setattr__(sonder_task, "_sonder_agent_id", agent_id)
    object.__setattr__(sonder_task, "_sonder_task_id", task_id)
    object.__setattr__(sonder_task, "_sonder_parent_id", parent_id)
    object.__setattr__(sonder_task, "_sonder_audit", audit_logger)
    object.__setattr__(sonder_task, "_sonder_context_factory", context_factory)
    object.__setattr__(sonder_task, "_sonder_wrapped", True)

    if isinstance(existing_config, SonderTaskConfig):
        object.__setattr__(sonder_task, "_sonder_config", existing_config)

    return sonder_task
