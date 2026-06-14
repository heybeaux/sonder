import type {
  ApprovalGate,
  GateRegistry,
  GovernanceContext,
  PolicyEvidenceRow,
  SonderAdapter,
  SonderEvent,
  SonderEventCore,
} from '@heybeaux/sonder-core';
import type { StateContract, CircuitState } from '@heybeaux/lattice-core';

export interface LatticeAdapterConfig {
  /**
   * Callback to retrieve the current StateContract for the agent.
   * Called on every contribute() — return null if no active contract.
   */
  getContract(): StateContract | null;

  /**
   * Callback to retrieve the current circuit breaker state.
   * Called on every contribute() — defaults to 'closed' if not provided.
   */
  getCircuitState?(): CircuitState;

  /**
   * Callback to retrieve the last validation result for the current contract.
   * Called on every contribute().
   */
  getLastValidation?(): LatticeValidationSnapshot | null;

  /**
   * Spike A.5 — pre-emit gate for policy-level approval gates. Called by
   * the emit pipeline before persistence. Return a gate to veto the emit
   * (state: 'pending'), or null to defer. Typically reads from the
   * active StateContract's approval-gate spec.
   */
  getGateStatus?(event: Partial<SonderEventCore>): ApprovalGate | null;
}

export interface LatticeValidationSnapshot {
  validated: boolean;
  l1_pass: boolean;
  l2_pass: boolean;
  l3_pass: boolean;
  violations: string[];
}

const EMPTY_GOVERNANCE: GovernanceContext = {
  contract_id: '',
  validated: false,
  l1_pass: false,
  l2_pass: false,
  l3_pass: false,
  violations: [],
  circuit_state: 'closed',
};

export class LatticeAdapter implements SonderAdapter {
  readonly name = 'lattice';
  readonly version = '0.1.0';

  private readonly config: LatticeAdapterConfig;

  constructor(config: LatticeAdapterConfig) {
    this.config = config;
  }

  async contribute(event: Partial<SonderEvent>): Promise<Partial<SonderEvent>> {
    const contract = this.config.getContract();

    if (!contract) {
      return { ...event, governance: EMPTY_GOVERNANCE };
    }

    const circuitState = this.config.getCircuitState?.() ?? 'closed';
    const lastValidation = this.config.getLastValidation?.() ?? null;

    const governance: GovernanceContext = {
      contract_id: contract.id,
      validated: lastValidation?.validated ?? false,
      l1_pass: lastValidation?.l1_pass ?? false,
      l2_pass: lastValidation?.l2_pass ?? false,
      l3_pass: lastValidation?.l3_pass ?? false,
      violations: lastValidation?.violations ?? [],
      circuit_state: circuitState,
    };

    return { ...event, governance };
  }

  async observe(event: SonderEvent): Promise<void> {
    // No-op in v1 — circuit breaker state is owned by Lattice itself.
    // Future: react to governance violations from other adapters.
    void event;
  }

  /**
   * Spike A.5 — pre-emit gate veto. Delegates to the operator's
   * `getGateStatus` callback, which typically consults the active
   * StateContract's approval-gate spec.
   */
  async checkGate(event: Partial<SonderEventCore>): Promise<ApprovalGate | null> {
    if (!this.config.getGateStatus) return null;
    return this.config.getGateStatus(event);
  }
}

/**
 * Canonical wire-up for option-C deployments: bind a `GateRegistry` to a
 * host-supplied gate factory. The factory decides — from contract + event —
 * whether this emit needs a gate at all and (if so) returns an
 * `ApprovalGate` envelope with a stable `gate_id`. The helper then:
 *
 *   1. If the registry already knows this gate_id:
 *      - resolved/expired → returns null (let emit proceed)
 *      - denied           → returns the denied gate (still vetoes via pending semantics in host)
 *      - pending          → returns the pending gate (vetoes emit)
 *   2. Otherwise registers the new gate and returns it pending.
 *
 * The factory MUST produce a deterministic `gate_id` for a given (contract,
 * event) so retries collapse onto the same record.
 */
export function createRegistryBackedGateStatus(args: {
  registry: GateRegistry;
  adapterName?: string;
  openGate(event: Partial<SonderEventCore>): ApprovalGate | null;
}): (event: Partial<SonderEventCore>) => ApprovalGate | null {
  const adapterName = args.adapterName ?? 'lattice';
  return (event) => {
    const candidate = args.openGate(event);
    if (!candidate) return null;

    const existing = args.registry.getStatus(candidate.gate_id);
    if (existing) {
      if (existing.status === 'resolved' || existing.status === 'expired') {
        return null;
      }
      return existing.gate;
    }

    args.registry.register(adapterName, candidate);
    return candidate;
  };
}

// ===========================================================================
// Aegis governance adapter (Phase 3.5 — Change 4)
// ===========================================================================

export interface AegisGovernanceContribution {
  /**
   * The approval-gate verdict recorded onto the decision event. This is the
   * Aegis label anchor: it records what the gate DECIDED (allowed/denied/
   * pending) at decision time, distinct from the pre-emit veto path
   * (`checkGate`), which only blocks persistence.
   */
  approval_gate?: ApprovalGate;
  /**
   * Per-rule L0 policy evidence backing the verdict. A free feature for the
   * Aegis label extractor — also satisfies the Spec 2 R12 sign-refusal
   * requirement when a governance `tier` claims L1/L2/L3.
   */
  evidence?: PolicyEvidenceRow[];
}

export interface AegisAdapterConfig {
  /**
   * Called on every `contribute()`. Returns the approval-gate verdict +
   * evidence to stamp onto this event's governance block, or `null` to
   * contribute nothing. Reads from the Aegis governance harness for the
   * event under construction.
   */
  getGovernance(event: Partial<SonderEventCore>): AegisGovernanceContribution | null;
}

/**
 * Phase 3.5 — populates `governance.approval_gate` + `governance.evidence`
 * on the decision event so the row carries its own label anchor and a free
 * evidence feature for the Aegis predictive layer (AWM).
 *
 * Why a contribute() adapter and not caller-supplied governance: in
 * `buildEnvelope` a registered adapter's diff overwrites the merged base
 * (`...DEFAULTS, ...base`), so caller-supplied governance would be clobbered
 * by any governance-returning adapter (e.g. LatticeAdapter's
 * `EMPTY_GOVERNANCE`). The safe path is the adapter contribution itself.
 *
 * Composition: this adapter reads the *current* governance off the snapshot
 * (whatever LatticeAdapter or another contributor already set) and overlays
 * only `approval_gate` / `evidence`, preserving validation/tier/violations.
 * Register it AFTER LatticeAdapter so it sees Lattice's governance.
 *
 * Recording is orthogonal to vetoing: a 'denied'/'pending' verdict recorded
 * here does NOT abort the emit — that is the `checkGate` path's job.
 */
export class AegisAdapter implements SonderAdapter {
  readonly name = 'aegis';
  readonly version = '0.1.0';

  private readonly config: AegisAdapterConfig;

  constructor(config: AegisAdapterConfig) {
    this.config = config;
  }

  async contribute(event: Partial<SonderEvent>): Promise<Partial<SonderEvent>> {
    const contribution = this.config.getGovernance(event);
    if (!contribution) return event;
    if (contribution.approval_gate === undefined && contribution.evidence === undefined) {
      return event;
    }

    // Preserve whatever governance an earlier adapter (e.g. Lattice) set;
    // overlay only the Aegis fields so we never clobber validation booleans,
    // tier, or violations.
    const base: GovernanceContext = event.governance ?? { ...EMPTY_GOVERNANCE };
    const governance: GovernanceContext = { ...base };
    if (contribution.approval_gate !== undefined) {
      governance.approval_gate = contribution.approval_gate;
    }
    if (contribution.evidence !== undefined) {
      governance.evidence = contribution.evidence;
    }

    return { ...event, governance };
  }

  async observe(event: SonderEvent): Promise<void> {
    void event;
  }
}
