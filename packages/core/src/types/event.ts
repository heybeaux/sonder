export type LODLevel = 'index' | 'summary' | 'standard' | 'deep';

export interface CapabilityContext {
  mounted: string[];
  resolution: Record<string, LODLevel>;
  budget_used: number;
  budget_limit: number;
}

export interface MemoryContext {
  refs: string[];
  query?: string;
  confidence: number;
  dream_cycle?: string;
}

export interface ReasoningContext {
  model: string;
  neurotypes: string[];
  consensus: boolean;
  dissent: string[];
  osi: number;
  rounds: number;
}

export interface GovernanceContext {
  contract_id: string;
  validated: boolean;
  l1_pass: boolean;
  l2_pass: boolean;
  l3_pass: boolean;
  violations: string[];
  circuit_state: 'closed' | 'open' | 'half-open';
}

export interface PredictionContext {
  outcome: string;
  confidence: number;
  alpha: number;
  beta: number;
  model_id: string;
}

export interface IntentContext {
  action: string;
  step_trace_id: string;
  skipped: boolean;
  skip_reason?: string;
  constraint_injected: boolean;
}

export interface SonderEvent {
  id: string;
  version: '1';
  agent_id: string;
  task_id: string;
  parent_id?: string;
  timestamp: string;

  capabilities: CapabilityContext;
  memory: MemoryContext;
  reasoning: ReasoningContext;
  governance: GovernanceContext;
  prediction: PredictionContext;
  intent: IntentContext;

  payload: unknown;
  metadata?: Record<string, unknown>;
}

export interface EventFilter {
  agent_id?: string;
  task_id?: string;
  from?: string;
  to?: string;
  validated?: boolean;
  violations?: string[];
  limit?: number;
  offset?: number;
}
