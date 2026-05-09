import type { SonderAdapter, SonderEvent, PredictionContext } from '@sonder/core';

export interface LeWMPredictionSnapshot {
  /** Predicted outcome label */
  outcome: string;
  /** Bayesian Beta distribution mean confidence (0–1) */
  confidence: number;
  /** Beta distribution alpha parameter (successes observed) */
  alpha: number;
  /** Beta distribution beta parameter (failures observed) */
  beta: number;
  /** LeWM model ID that produced this prediction */
  model_id: string;
}

export interface LeWMAdapterConfig {
  /**
   * Callback to retrieve the current prediction for the agent's next action.
   * Return null if LeWM has not produced a prediction yet.
   */
  getCurrentPrediction(): LeWMPredictionSnapshot | null;
}

const EMPTY_PREDICTION: PredictionContext = {
  outcome: '',
  confidence: 0,
  alpha: 1,
  beta: 1,
  model_id: '',
};

export class LewmAdapter implements SonderAdapter {
  readonly name = 'lewm';
  readonly version = '0.1.0';

  private readonly config: LeWMAdapterConfig;

  constructor(config: LeWMAdapterConfig) {
    this.config = config;
  }

  async contribute(event: Partial<SonderEvent>): Promise<Partial<SonderEvent>> {
    const prediction = this.config.getCurrentPrediction();

    if (!prediction) {
      return { ...event, prediction: EMPTY_PREDICTION };
    }

    const predictionContext: PredictionContext = {
      outcome: prediction.outcome,
      confidence: prediction.confidence,
      alpha: prediction.alpha,
      beta: prediction.beta,
      model_id: prediction.model_id,
    };

    return { ...event, prediction: predictionContext };
  }

  async observe(event: SonderEvent): Promise<void> {
    // Future: update Beta distribution parameters based on observed outcomes
    // from governance violations (Lattice) and AWM step traces.
    void event;
  }
}
