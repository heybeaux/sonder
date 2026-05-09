import type { SonderAdapter, SonderEvent, IntentContext } from '@sonder/core';

export interface AWMIntentSnapshot {
  /** The action being taken */
  action: string;
  /** AWM StepTrace reference ID */
  step_trace_id: string;
  /** Whether this step was skipped due to high prediction confidence */
  skipped: boolean;
  /** Reason for skip, if skipped */
  skip_reason?: string;
  /** Whether an approval gate pre-injected constraints for this action */
  constraint_injected: boolean;
}

export interface AWMAdapterConfig {
  /**
   * Callback to retrieve the current AWM intent for the agent's next action.
   * Return null if AWM has not resolved an intent yet.
   */
  getCurrentIntent(): AWMIntentSnapshot | null;
}

const EMPTY_INTENT: IntentContext = {
  action: '',
  step_trace_id: '',
  skipped: false,
  constraint_injected: false,
};

export class AwmAdapter implements SonderAdapter {
  readonly name = 'awm';
  readonly version = '0.1.0';

  private readonly config: AWMAdapterConfig;

  constructor(config: AWMAdapterConfig) {
    this.config = config;
  }

  async contribute(event: Partial<SonderEvent>): Promise<Partial<SonderEvent>> {
    const intent = this.config.getCurrentIntent();

    if (!intent) {
      return { ...event, intent: EMPTY_INTENT };
    }

    const intentContext: IntentContext = {
      action: intent.action,
      step_trace_id: intent.step_trace_id,
      skipped: intent.skipped,
      constraint_injected: intent.constraint_injected,
      ...(intent.skip_reason !== undefined && { skip_reason: intent.skip_reason }),
    };

    return { ...event, intent: intentContext };
  }

  async observe(event: SonderEvent): Promise<void> {
    // Future: close the learning loop by reading LeWM prediction results
    // from events and updating AWM's outcome models.
    void event;
  }
}
