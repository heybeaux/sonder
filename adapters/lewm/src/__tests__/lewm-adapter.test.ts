import { describe, it, expect } from 'vitest';
import { LewmAdapter } from '../index.js';

describe('LewmAdapter', () => {
  it('contributes empty prediction when no snapshot', async () => {
    const adapter = new LewmAdapter({ getCurrentPrediction: () => null });
    const result = await adapter.contribute({});
    expect(result.prediction?.outcome).toBe('');
    expect(result.prediction?.confidence).toBe(0);
    expect(result.prediction?.alpha).toBe(1);
    expect(result.prediction?.beta).toBe(1);
    expect(result.prediction?.model_id).toBe('');
  });

  it('contributes prediction outcome and confidence', async () => {
    const adapter = new LewmAdapter({
      getCurrentPrediction: () => ({
        outcome: 'handoff_success',
        confidence: 0.83,
        alpha: 15,
        beta: 3,
        model_id: 'lewm-v1-beta',
      }),
    });
    const result = await adapter.contribute({});
    expect(result.prediction?.outcome).toBe('handoff_success');
    expect(result.prediction?.confidence).toBe(0.83);
  });

  it('contributes Beta distribution parameters', async () => {
    const adapter = new LewmAdapter({
      getCurrentPrediction: () => ({
        outcome: 'validation_fail',
        confidence: 0.25,
        alpha: 2,
        beta: 6,
        model_id: 'lewm-v1-beta',
      }),
    });
    const result = await adapter.contribute({});
    expect(result.prediction?.alpha).toBe(2);
    expect(result.prediction?.beta).toBe(6);
  });

  it('contributes model_id', async () => {
    const adapter = new LewmAdapter({
      getCurrentPrediction: () => ({
        outcome: 'success',
        confidence: 0.9,
        alpha: 18,
        beta: 2,
        model_id: 'lewm-v2',
      }),
    });
    const result = await adapter.contribute({});
    expect(result.prediction?.model_id).toBe('lewm-v2');
  });

  it('preserves other event fields', async () => {
    const adapter = new LewmAdapter({ getCurrentPrediction: () => null });
    const result = await adapter.contribute({ agent_id: 'agent-123' });
    expect(result.agent_id).toBe('agent-123');
  });

  it('observe: no-op when onGovernanceOutcome not provided', async () => {
    const adapter = new LewmAdapter({ getCurrentPrediction: () => null });
    await expect(adapter.observe({} as never)).resolves.toBeUndefined();
  });

  it('observe: no-op when event has no contract_id', async () => {
    const calls: string[] = [];
    const adapter = new LewmAdapter({
      getCurrentPrediction: () => null,
      onGovernanceOutcome: (outcome) => calls.push(outcome),
    });
    await adapter.observe({ governance: { contract_id: '', validated: true, violations: [] } } as never);
    expect(calls).toHaveLength(0);
  });

  it('observe: fires pass when governance validated=true', async () => {
    const calls: Array<{ outcome: string; violations: string[] }> = [];
    const adapter = new LewmAdapter({
      getCurrentPrediction: () => null,
      onGovernanceOutcome: (outcome, violations) => calls.push({ outcome, violations }),
    });
    await adapter.observe({
      governance: { contract_id: 'c1', validated: true, violations: [] },
    } as never);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.outcome).toBe('pass');
    expect(calls[0]!.violations).toEqual([]);
  });

  it('observe: fires fail with violations when governance validated=false', async () => {
    const calls: Array<{ outcome: string; violations: string[] }> = [];
    const adapter = new LewmAdapter({
      getCurrentPrediction: () => null,
      onGovernanceOutcome: (outcome, violations) => calls.push({ outcome, violations }),
    });
    await adapter.observe({
      governance: { contract_id: 'c1', validated: false, violations: ['L1_TYPE_MISMATCH'] },
    } as never);
    expect(calls[0]!.outcome).toBe('fail');
    expect(calls[0]!.violations).toContain('L1_TYPE_MISMATCH');
  });
});
