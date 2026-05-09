import type { SonderAdapter, SonderEvent, MemoryContext } from '@sonder/core';

export interface EngramRetrievalSnapshot {
  /** IDs of memory records consulted in the last retrieval */
  refs: string[];
  /** Semantic query used for retrieval */
  query?: string;
  /** Ensemble retrieval confidence (0–1) */
  confidence: number;
  /** Dream/consolidation cycle ID if memory was surfaced post-consolidation */
  dream_cycle?: string;
}

export interface EngramAdapterConfig {
  /**
   * Callback to retrieve the last Engram retrieval result for the current agent turn.
   * Called on every contribute() — return null if no retrieval has occurred.
   */
  getLastRetrieval(): EngramRetrievalSnapshot | null;
}

const EMPTY_MEMORY: MemoryContext = {
  refs: [],
  confidence: 0,
};

export class EngramAdapter implements SonderAdapter {
  readonly name = 'engram';
  readonly version = '0.1.0';

  private readonly config: EngramAdapterConfig;

  constructor(config: EngramAdapterConfig) {
    this.config = config;
  }

  async contribute(event: Partial<SonderEvent>): Promise<Partial<SonderEvent>> {
    const retrieval = this.config.getLastRetrieval();

    if (!retrieval) {
      return { ...event, memory: EMPTY_MEMORY };
    }

    const memory: MemoryContext = {
      refs: retrieval.refs,
      confidence: retrieval.confidence,
      ...(retrieval.query !== undefined && { query: retrieval.query }),
      ...(retrieval.dream_cycle !== undefined && { dream_cycle: retrieval.dream_cycle }),
    };

    return { ...event, memory };
  }

  async observe(_event: SonderEvent): Promise<void> {
    // No-op in v1 — Engram does not need to react to other adapters' events.
  }
}
