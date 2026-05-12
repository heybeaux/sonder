import type { SonderAdapter, SonderEvent, GovernanceContext } from '@heybeaux/sonder-core';
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
}
