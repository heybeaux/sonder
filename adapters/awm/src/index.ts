import type { SonderAdapter, SonderEvent, IntentContext } from '@heybeaux/sonder-core';

export type AWMOutcome = 'pass' | 'revise' | 'fail';

export interface AWMIntentSnapshot {
  /** The action/step type being taken (e.g. 'creative-director', 'red-team') */
  action: string;
  /** AWM StepTrace traceId reference */
  step_trace_id: string;
  /** Whether AWM recommended skipping this step (high confidence, output unchanged) */
  skipped: boolean;
  /** Reason for skip if skipped=true */
  skip_reason?: string;
  /** Whether approval gate pre-injected constraints into this step's prompt */
  constraint_injected: boolean;
}

export interface AWMAdapterConfig {
  /**
   * Callback to retrieve the current AWM intent snapshot before a step executes.
   * Maps from Oracle.predict() result + StepTrace context.
   * Return null if AWM has not resolved an intent for this step.
   */
  getCurrentIntent(): AWMIntentSnapshot | null;

  /**
   * Called when an observed event has a resolvable step outcome.
   * AWM uses this to score LeWM's predictions — recording whether the step
   * trace matched its predicted outcome so calibration can be updated.
   * Only fired when the event carries both a step_trace_id and a governance result.
   */
  onStepOutcome?(stepTraceId: string, outcome: AWMOutcome, event: SonderEvent): void;
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
    if (!this.config.onStepOutcome) return;
    if (!event.intent.step_trace_id) return;
    if (!event.governance.contract_id) return;

    const outcome: AWMOutcome = event.governance.validated ? 'pass' : 'fail';
    this.config.onStepOutcome(event.intent.step_trace_id, outcome, event);
  }
}
