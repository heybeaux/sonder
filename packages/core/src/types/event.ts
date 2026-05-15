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

/**
 * Per-rule evidence emitted by Lattice L0 policy engine (Spec 1 R7/R8).
 *
 * Sonder MUST NOT redefine this shape — it is mirrored here so the v2
 * SonderEvent type compiles without a hard dep on @heybeaux/lattice-core.
 * When Lattice v0.4.0+ is on the dep tree this type will be replaced with
 * `import type { PolicyEvidenceRow } from '@heybeaux/lattice-core'`.
 */
export interface PolicyEvidenceRow {
  rule_id: string;
  rule_kind: string;
  path?: string;
  outcome: 'pass' | 'deny' | 'mask';
  matched?: string;
  message?: string;
}

/**
 * Spike A.5 — pre-emit approval gate.
 *
 * When `approval_gate.state === 'pending'`, the emit pipeline aborts before
 * persistence and throws `GatePendingError`. Resolved out-of-band by
 * Ginnung (or any supervisor surface) flipping state to 'allowed' |
 * 'denied' via the adapter, after which the original emit can be retried.
 */
export interface ApprovalGate {
  state: 'pending' | 'allowed' | 'denied';
  gate_id: string;
  reason?: string;
  default_action: 'deny' | 'allow';
  /** Wall-clock deadline (ISO 8601). After this, default_action applies. */
  expires_at?: string;
}

export interface GovernanceContext {
  contract_id: string;
  validated: boolean;
  l1_pass: boolean;
  l2_pass: boolean;
  l3_pass: boolean;
  violations: string[];
  circuit_state: 'closed' | 'open' | 'half-open';
  /**
   * v2: `+`-joined list of Lattice tiers that produced evidence,
   * e.g. 'L0', 'L0+L1', 'L0+L1+L2'. Absent for non-Lattice emitters.
   */
  tier?: string;
  /**
   * v2: L0 per-rule evidence. Required when `tier` references L1/L2/L3
   * (Spec 2 R12 — sign-refusal); optional otherwise.
   */
  evidence?: PolicyEvidenceRow[];
  /**
   * Spike A.5 — pre-emit approval gate. When present and pending, the
   * emit pipeline aborts before persistence.
   */
  approval_gate?: ApprovalGate;
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

/** Redaction evidence block populated by the redactor at emit time. */
export interface RedactionEvidence {
  fields: string[];
  count: number;
  sensitivityLevel: 'low' | 'medium' | 'high';
}

/**
 * Common envelope shared by v1 and v2 events — the cognitive-context
 * surface that adapters mutate via `contribute`. Adapters MUST NOT add
 * chain/signature fields.
 */
export interface SonderEventCore {
  id: string;
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

/**
 * v1 schema — preserved for back-compat reads from the AuditLog.
 * New writes always produce v2 events.
 */
export interface SonderEventV1 extends SonderEventCore {
  version: '1';
}

/**
 * v2 schema — adds the chain-and-sign fields (Spec 2 R1) and the
 * `metadata.redaction` evidence block.
 */
export interface SonderEventV2 extends SonderEventCore {
  version: '2';

  metadata: Record<string, unknown> & {
    redaction: RedactionEvidence;
  };

  /** Hex chain link to the predecessor's chain_self_hash (Spec 2 R2 / R4). */
  chain_prev_hash: string;
  /** Hex sha256 of canonicalize(event without chain_self_hash + signature). */
  chain_self_hash: string;
  /** Base64 ed25519 signature over canonicalize(event without signature). */
  signature: string;
}

/**
 * Default consumer-facing alias. Equals SonderEventV2 — the v2 schema is
 * what `runtime.emit` produces. Consumers that need to discriminate on
 * `version` (e.g. AuditLog queries returning mixed rows) should use
 * `SonderEventAny`.
 */
export type SonderEvent = SonderEventV2;

/** Union for AuditLog reads that may include legacy v1 rows. */
export type SonderEventAny = SonderEventV1 | SonderEventV2;

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
