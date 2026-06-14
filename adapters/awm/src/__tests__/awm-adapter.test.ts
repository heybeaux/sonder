import { describe, it, expect } from 'vitest';
import { AwmAdapter } from '../index.js';

describe('AwmAdapter', () => {
  it('contributes empty intent when no snapshot', async () => {
    const adapter = new AwmAdapter({ getCurrentIntent: () => null });
    const result = await adapter.contribute({});
    expect(result.intent?.action).toBe('');
    expect(result.intent?.step_trace_id).toBe('');
    expect(result.intent?.skipped).toBe(false);
    expect(result.intent?.constraint_injected).toBe(false);
    expect(result.intent?.skip_reason).toBeUndefined();
  });

  it('contributes action and step_trace_id', async () => {
    const adapter = new AwmAdapter({
      getCurrentIntent: () => ({
        action: 'draft_linkedin_post',
        step_trace_id: 'trace-abc-123',
        skipped: false,
        constraint_injected: false,
      }),
    });
    const result = await adapter.contribute({});
    expect(result.intent?.action).toBe('draft_linkedin_post');
    expect(result.intent?.step_trace_id).toBe('trace-abc-123');
  });

  it('contributes skipped=true with skip_reason', async () => {
    const adapter = new AwmAdapter({
      getCurrentIntent: () => ({
        action: 'validate_output',
        step_trace_id: 'trace-xyz-456',
        skipped: true,
        skip_reason: 'prediction_confidence_above_threshold',
        constraint_injected: false,
      }),
    });
    const result = await adapter.contribute({});
    expect(result.intent?.skipped).toBe(true);
    expect(result.intent?.skip_reason).toBe('prediction_confidence_above_threshold');
  });

  it('omits skip_reason when not provided', async () => {
    const adapter = new AwmAdapter({
      getCurrentIntent: () => ({
        action: 'send_message',
        step_trace_id: 'trace-001',
        skipped: false,
        constraint_injected: false,
      }),
    });
    const result = await adapter.contribute({});
    expect(result.intent?.skip_reason).toBeUndefined();
  });

  it('contributes constraint_injected=true', async () => {
    const adapter = new AwmAdapter({
      getCurrentIntent: () => ({
        action: 'execute_trade',
        step_trace_id: 'trace-002',
        skipped: false,
        constraint_injected: true,
      }),
    });
    const result = await adapter.contribute({});
    expect(result.intent?.constraint_injected).toBe(true);
  });

  it('preserves other event fields', async () => {
    const adapter = new AwmAdapter({ getCurrentIntent: () => null });
    const result = await adapter.contribute({ task_id: 'task-999' });
    expect(result.task_id).toBe('task-999');
  });

  it('observe: no-op when onStepOutcome not provided', async () => {
    const adapter = new AwmAdapter({ getCurrentIntent: () => null });
    await expect(adapter.observe({} as never)).resolves.toBeUndefined();
  });

  it('observe: no-op when event has no step_trace_id', async () => {
    const calls: string[] = [];
    const adapter = new AwmAdapter({
      getCurrentIntent: () => null,
      onStepOutcome: (traceId) => calls.push(traceId),
    });
    await adapter.observe({
      intent: { step_trace_id: '' },
      governance: { contract_id: 'c1', validated: true },
    } as never);
    expect(calls).toHaveLength(0);
  });

  it('observe: no-op when event has no contract_id', async () => {
    const calls: string[] = [];
    const adapter = new AwmAdapter({
      getCurrentIntent: () => null,
      onStepOutcome: (traceId) => calls.push(traceId),
    });
    await adapter.observe({
      intent: { step_trace_id: 'trace-001' },
      governance: { contract_id: '', validated: true },
    } as never);
    expect(calls).toHaveLength(0);
  });

  it('observe: fires pass with step_trace_id when governance validated=true', async () => {
    const calls: Array<{ traceId: string; outcome: string }> = [];
    const adapter = new AwmAdapter({
      getCurrentIntent: () => null,
      onStepOutcome: (traceId, outcome) => calls.push({ traceId, outcome }),
    });
    await adapter.observe({
      intent: { step_trace_id: 'trace-abc' },
      governance: { contract_id: 'c1', validated: true },
    } as never);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.traceId).toBe('trace-abc');
    expect(calls[0]!.outcome).toBe('pass');
  });

  it('observe: fires fail when governance validated=false', async () => {
    const calls: Array<{ traceId: string; outcome: string }> = [];
    const adapter = new AwmAdapter({
      getCurrentIntent: () => null,
      onStepOutcome: (traceId, outcome) => calls.push({ traceId, outcome }),
    });
    await adapter.observe({
      intent: { step_trace_id: 'trace-xyz' },
      governance: { contract_id: 'c1', validated: false },
    } as never);
    expect(calls[0]!.outcome).toBe('fail');
    expect(calls[0]!.traceId).toBe('trace-xyz');
  });
});
