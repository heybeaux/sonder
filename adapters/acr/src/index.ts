import type { SonderAdapter, SonderEvent, CapabilityContext, LODLevel } from '@heybeaux/sonder-core';

export interface ACRCapabilitySnapshot {
  /** IDs of capabilities currently mounted */
  mounted: string[];
  /** LOD resolution level per capability ID */
  resolution: Record<string, LODLevel>;
  /** Tokens consumed by capability instructions in the current context */
  budget_used: number;
  /** Total token budget for capability instructions */
  budget_limit: number;
}

export interface ACRAdapterConfig {
  /**
   * Callback to retrieve the current ACR capability state.
   * Return null if ACR is not active or no capabilities are mounted.
   */
  getCapabilities(): ACRCapabilitySnapshot | null;
}

const EMPTY_CAPABILITIES: CapabilityContext = {
  mounted: [],
  resolution: {},
  budget_used: 0,
  budget_limit: 0,
};

export class AcrAdapter implements SonderAdapter {
  readonly name = 'acr';
  readonly version = '0.1.0';

  private readonly config: ACRAdapterConfig;

  constructor(config: ACRAdapterConfig) {
    this.config = config;
  }

  async contribute(event: Partial<SonderEvent>): Promise<Partial<SonderEvent>> {
    const snapshot = this.config.getCapabilities();

    if (!snapshot) {
      return { ...event, capabilities: EMPTY_CAPABILITIES };
    }

    const capabilities: CapabilityContext = {
      mounted: snapshot.mounted,
      resolution: snapshot.resolution,
      budget_used: snapshot.budget_used,
      budget_limit: snapshot.budget_limit,
    };

    return { ...event, capabilities };
  }

  async observe(_event: SonderEvent): Promise<void> {
    // No-op in v1.
  }
}
