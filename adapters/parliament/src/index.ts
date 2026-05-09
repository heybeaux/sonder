import type { SonderAdapter, SonderEvent, ReasoningContext } from '@sonder/core';

export interface ParliamentDeliberationSnapshot {
  /** Primary model used for deliberation */
  model: string;
  /** Active neurotype IDs that participated */
  neurotypes: string[];
  /** Whether all neurotypes reached consensus */
  consensus: boolean;
  /** Neurotype IDs that dissented */
  dissent: string[];
  /** Opinion Shift Index — convergence quality (0–1, lower = echo-chamber-like) */
  osi: number;
  /** Number of deliberation rounds taken */
  rounds: number;
}

export interface ParliamentAdapterConfig {
  /**
   * Callback to retrieve the last deliberation result for the current agent turn.
   * Return null if no deliberation has occurred.
   */
  getLastDeliberation(): ParliamentDeliberationSnapshot | null;
}

const EMPTY_REASONING: ReasoningContext = {
  model: '',
  neurotypes: [],
  consensus: false,
  dissent: [],
  osi: 0,
  rounds: 0,
};

export class ParliamentAdapter implements SonderAdapter {
  readonly name = 'parliament';
  readonly version = '0.1.0';

  private readonly config: ParliamentAdapterConfig;

  constructor(config: ParliamentAdapterConfig) {
    this.config = config;
  }

  async contribute(event: Partial<SonderEvent>): Promise<Partial<SonderEvent>> {
    const deliberation = this.config.getLastDeliberation();

    if (!deliberation) {
      return { ...event, reasoning: EMPTY_REASONING };
    }

    const reasoning: ReasoningContext = {
      model: deliberation.model,
      neurotypes: deliberation.neurotypes,
      consensus: deliberation.consensus,
      dissent: deliberation.dissent,
      osi: deliberation.osi,
      rounds: deliberation.rounds,
    };

    return { ...event, reasoning };
  }

  async observe(_event: SonderEvent): Promise<void> {
    // No-op in v1.
  }
}
