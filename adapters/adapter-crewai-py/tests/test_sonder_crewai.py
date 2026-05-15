from __future__ import annotations

import json
import tempfile
import threading
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from crewai import Task as CrewTask

from sonder_crewai import (
    CapabilityContext,
    GovernanceContext,
    IntentContext,
    MemoryContext,
    PredictionContext,
    ReasoningContext,
    SonderAuditLogger,
    SonderCrewMiddleware,
    SonderEvent,
    SonderTaskConfig,
    configure_task,
    wrap_task,
)
from sonder_crewai.wrapper import SonderTask


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_task(description="Analyze the codebase", expected_output="A report"):
    return CrewTask(description=description, expected_output=expected_output)


def _make_mock_crew(tasks):
    crew = MagicMock()
    crew.tasks = list(tasks)
    result = MagicMock()
    result.raw = "Crew done."
    crew.kickoff.return_value = result
    return crew


def _tmp_log() -> str:
    f = tempfile.NamedTemporaryFile(suffix=".jsonl", delete=False)
    f.close()
    return f.name


# ---------------------------------------------------------------------------
# SonderEvent serialization
# ---------------------------------------------------------------------------

def test_sonder_event_to_dict_has_all_faculties():
    event = SonderEvent(agent_id="analyst", task_id="task:0", payload={"test": True})
    d = event.to_dict()
    for key in ("id", "version", "agentId", "taskId", "timestamp", "payload",
                "capabilities", "memory", "reasoning", "governance", "prediction", "intent"):
        assert key in d, f"missing key: {key}"


def test_sonder_event_parent_id_omitted_when_none():
    event = SonderEvent(agent_id="a", task_id="t", payload={})
    assert "parentId" not in event.to_dict()


def test_sonder_event_parent_id_included_when_set():
    event = SonderEvent(agent_id="a", task_id="t", payload={}, parent_id="parent-ulid")
    assert event.to_dict()["parentId"] == "parent-ulid"


def test_capability_context_serializes():
    ctx = CapabilityContext(mounted=["git", "grep"], budget_used=100, budget_limit=1000)
    d = ctx.to_dict()
    assert d["mounted"] == ["git", "grep"]
    assert d["budgetUsed"] == 100


def test_governance_context_serializes():
    ctx = GovernanceContext(validated=False, violations=["schema_mismatch"], circuit_state="open")
    d = ctx.to_dict()
    assert d["validated"] is False
    assert d["violations"] == ["schema_mismatch"]
    assert d["circuitState"] == "open"


# ---------------------------------------------------------------------------
# Audit logger
# ---------------------------------------------------------------------------

def test_audit_logger_writes_jsonl():
    path = _tmp_log()
    logger = SonderAuditLogger(path)
    event = SonderEvent(agent_id="x", task_id="t", payload={"hello": "world"})
    logger.log(event)
    lines = Path(path).read_text().strip().splitlines()
    assert len(lines) == 1
    parsed = json.loads(lines[0])
    assert parsed["agentId"] == "x"
    assert parsed["payload"]["hello"] == "world"


def test_audit_logger_thread_safe():
    path = _tmp_log()
    logger = SonderAuditLogger(path)
    events = [SonderEvent(agent_id=f"a{i}", task_id="t", payload={}) for i in range(30)]
    threads = [threading.Thread(target=logger.log, args=(e,)) for e in events]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    lines = Path(path).read_text().strip().splitlines()
    assert len(lines) == 30


def test_audit_logger_creates_parent_dirs(tmp_path):
    nested = tmp_path / "a" / "b" / "c" / "audit.jsonl"
    logger = SonderAuditLogger(nested)
    event = SonderEvent(agent_id="x", task_id="t", payload={})
    logger.log(event)
    assert nested.exists()


# ---------------------------------------------------------------------------
# wrap_task — returns SonderTask subclass
# ---------------------------------------------------------------------------

def test_wrap_task_returns_sonder_task():
    task = _make_task()
    path = _tmp_log()
    result = wrap_task(task, agent_id="analyst", task_id="t:0", audit_logger=SonderAuditLogger(path))
    assert isinstance(result, SonderTask)


def test_wrap_task_sets_agent_id_and_task_id():
    task = _make_task()
    path = _tmp_log()
    st = wrap_task(task, agent_id="analyst", task_id="t:0", audit_logger=SonderAuditLogger(path))
    assert st._sonder_agent_id == "analyst"
    assert st._sonder_task_id == "t:0"


def test_wrap_task_preserves_description_and_expected_output():
    task = _make_task(description="Do research", expected_output="A summary")
    path = _tmp_log()
    st = wrap_task(task, agent_id="analyst", task_id="t:0", audit_logger=SonderAuditLogger(path))
    assert st.description == "Do research"
    assert st.expected_output == "A summary"


def test_wrap_task_idempotent_on_sonder_task():
    task = _make_task()
    path = _tmp_log()
    st = wrap_task(task, agent_id="analyst", task_id="t:0", audit_logger=SonderAuditLogger(path))
    st2 = wrap_task(st, agent_id="analyst", task_id="t:0", audit_logger=SonderAuditLogger(path))
    assert st is st2


def test_wrap_task_carries_configure_task_config():
    task = _make_task()
    reasoning = ReasoningContext(model="gpt-4o", osi=0.1)
    configure_task(task, sonder=SonderTaskConfig(reasoning=reasoning))

    path = _tmp_log()
    st = wrap_task(task, agent_id="analyst", task_id="t:0", audit_logger=SonderAuditLogger(path))
    assert isinstance(st._sonder_config, SonderTaskConfig)
    assert st._sonder_config.reasoning.model == "gpt-4o"


def test_wrap_task_parent_id_set():
    task = _make_task()
    path = _tmp_log()
    st = wrap_task(task, agent_id="a", task_id="t:0", audit_logger=SonderAuditLogger(path), parent_id="parent-xyz")
    assert st._sonder_parent_id == "parent-xyz"


# ---------------------------------------------------------------------------
# SonderCrewMiddleware
# ---------------------------------------------------------------------------

def test_middleware_replaces_tasks_with_sonder_tasks():
    t1 = _make_task()
    t2 = _make_task()
    crew = _make_mock_crew([t1, t2])

    SonderCrewMiddleware(crew, audit_log_path=_tmp_log())

    assert all(isinstance(t, SonderTask) for t in crew.tasks)


def test_middleware_kickoff_delegates():
    task = _make_task()
    crew = _make_mock_crew([task])
    wrapped = SonderCrewMiddleware(crew, audit_log_path=_tmp_log())
    result = wrapped.kickoff(inputs={"project": "sonder"})
    crew.kickoff.assert_called_once_with(inputs={"project": "sonder"})
    assert result is crew.kickoff.return_value


def test_middleware_skips_already_wrapped():
    task = _make_task()
    crew = _make_mock_crew([task])
    SonderCrewMiddleware(crew, audit_log_path=_tmp_log())
    already_wrapped = crew.tasks[0]
    assert isinstance(already_wrapped, SonderTask)

    SonderCrewMiddleware(crew, audit_log_path=_tmp_log())
    assert crew.tasks[0] is already_wrapped


def test_middleware_uses_stable_workflow_id():
    t1 = _make_task()
    t2 = _make_task()
    crew = _make_mock_crew([t1, t2])
    wid = "my-workflow-id"
    SonderCrewMiddleware(crew, audit_log_path=_tmp_log(), workflow_id=wid)
    assert crew.tasks[0]._sonder_task_id.startswith(wid)
    assert crew.tasks[1]._sonder_task_id.startswith(wid)


def test_middleware_chains_parent_ids():
    t1 = _make_task()
    t2 = _make_task()
    crew = _make_mock_crew([t1, t2])
    SonderCrewMiddleware(crew, audit_log_path=_tmp_log(), workflow_id="wf")
    assert crew.tasks[0]._sonder_parent_id is None
    assert crew.tasks[1]._sonder_parent_id == crew.tasks[0]._sonder_task_id


# ---------------------------------------------------------------------------
# configure_task
# ---------------------------------------------------------------------------

def test_configure_task_sets_sonder_config():
    task = _make_task()
    config = SonderTaskConfig(memory=MemoryContext(refs=["engram:abc"], tokens_retrieved=200))
    configure_task(task, sonder=config)
    assert task.__dict__["_sonder_config"] is config
    assert task.__dict__["_sonder_config"].memory.refs == ["engram:abc"]
