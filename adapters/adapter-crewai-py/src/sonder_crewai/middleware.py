from __future__ import annotations

from pathlib import Path
from typing import Any

from ulid import ULID

from .audit import SonderAuditLogger
from .wrapper import SonderTask, wrap_task


class SonderCrewMiddleware:
    """Instruments an entire CrewAI Crew with Sonder cognitive event emission.

    Replaces each task in the crew with a SonderTask that emits before+after
    SonderEvents to a JSONL audit log at each execution step.

    Usage:
        crew = Crew(agents=[...], tasks=[...], process=Process.sequential)
        wrapped = SonderCrewMiddleware(crew, audit_log_path="./sonder-audit.jsonl")
        result = wrapped.kickoff()
    """

    def __init__(
        self,
        crew: Any,
        *,
        audit_log_path: str | Path = "./sonder-audit.jsonl",
        workflow_id: str | None = None,
    ) -> None:
        self._crew = crew
        self._workflow_id = workflow_id or str(ULID())
        self._audit = SonderAuditLogger(audit_log_path)
        self._wrap_crew_tasks()

    def _wrap_crew_tasks(self) -> None:
        tasks = getattr(self._crew, "tasks", [])
        wrapped: list[Any] = []
        parent_id: str | None = None

        for i, task in enumerate(tasks):
            if isinstance(task, SonderTask):
                wrapped.append(task)
                parent_id = task._sonder_task_id
                continue

            agent = getattr(task, "agent", None)
            agent_id = getattr(agent, "role", f"task_{i}") if agent else f"task_{i}"
            task_id = f"{self._workflow_id}:{i}:{agent_id}"

            sonder_task = wrap_task(
                task,
                agent_id=agent_id,
                task_id=task_id,
                audit_logger=self._audit,
                parent_id=parent_id,
            )
            wrapped.append(sonder_task)
            parent_id = task_id

        # Replace the crew's task list with instrumented tasks
        self._crew.tasks = wrapped

    def kickoff(self, inputs: dict | None = None) -> Any:
        return self._crew.kickoff(inputs=inputs)

    async def kickoff_async(self, inputs: dict | None = None) -> Any:
        return await self._crew.kickoff_async(inputs=inputs)

    def kickoff_for_each(self, inputs: list[dict]) -> list[Any]:
        return self._crew.kickoff_for_each(inputs=inputs)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._crew, name)
