from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from ulid import ULID


@dataclass
class CapabilityContext:
    mounted: list[str] = field(default_factory=list)
    resolution: dict[str, str] = field(default_factory=dict)
    budget_used: int = 0
    budget_limit: int = 0

    def to_dict(self) -> dict:
        return {
            "mounted": self.mounted,
            "resolution": self.resolution,
            "budgetUsed": self.budget_used,
            "budgetLimit": self.budget_limit,
        }


@dataclass
class MemoryContext:
    refs: list[str] = field(default_factory=list)
    tokens_retrieved: int = 0

    def to_dict(self) -> dict:
        return {
            "refs": self.refs,
            "tokensRetrieved": self.tokens_retrieved,
        }


@dataclass
class ReasoningContext:
    model: str = ""
    neurotypes: list[str] = field(default_factory=list)
    consensus: bool = True
    dissent: list[str] = field(default_factory=list)
    osi: float = 0.0
    rounds: int = 1

    def to_dict(self) -> dict:
        return {
            "model": self.model,
            "neurotypes": self.neurotypes,
            "consensus": self.consensus,
            "dissent": self.dissent,
            "osi": self.osi,
            "rounds": self.rounds,
        }


@dataclass
class GovernanceContext:
    contract_id: str = ""
    validated: bool = True
    l1_pass: bool = True
    l2_pass: bool = True
    l3_pass: bool = True
    violations: list[str] = field(default_factory=list)
    circuit_state: str = "closed"

    def to_dict(self) -> dict:
        return {
            "contractId": self.contract_id,
            "validated": self.validated,
            "l1Pass": self.l1_pass,
            "l2Pass": self.l2_pass,
            "l3Pass": self.l3_pass,
            "violations": self.violations,
            "circuitState": self.circuit_state,
        }


@dataclass
class PredictionContext:
    predicted: bool = False
    confidence: float = 0.0
    alpha: float = 1.0
    beta: float = 1.0

    def to_dict(self) -> dict:
        return {
            "predicted": self.predicted,
            "confidence": self.confidence,
            "alpha": self.alpha,
            "beta": self.beta,
        }


@dataclass
class IntentContext:
    intent_id: str = ""
    step: str = ""
    workflow_id: str = ""

    def to_dict(self) -> dict:
        return {
            "intentId": self.intent_id,
            "step": self.step,
            "workflowId": self.workflow_id,
        }


@dataclass
class SonderEvent:
    agent_id: str
    task_id: str
    payload: Any
    id: str = field(default_factory=lambda: str(ULID()))
    version: str = "1"
    parent_id: str | None = None
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    capabilities: CapabilityContext = field(default_factory=CapabilityContext)
    memory: MemoryContext = field(default_factory=MemoryContext)
    reasoning: ReasoningContext = field(default_factory=ReasoningContext)
    governance: GovernanceContext = field(default_factory=GovernanceContext)
    prediction: PredictionContext = field(default_factory=PredictionContext)
    intent: IntentContext = field(default_factory=IntentContext)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        d: dict[str, Any] = {
            "id": self.id,
            "version": self.version,
            "agentId": self.agent_id,
            "taskId": self.task_id,
            "timestamp": self.timestamp,
            "capabilities": self.capabilities.to_dict(),
            "memory": self.memory.to_dict(),
            "reasoning": self.reasoning.to_dict(),
            "governance": self.governance.to_dict(),
            "prediction": self.prediction.to_dict(),
            "intent": self.intent.to_dict(),
            "payload": self.payload,
            "metadata": self.metadata,
        }
        if self.parent_id is not None:
            d["parentId"] = self.parent_id
        return d
