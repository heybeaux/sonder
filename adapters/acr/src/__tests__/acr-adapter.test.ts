import { describe, it, expect } from 'vitest';
import { AcrAdapter } from '../index.js';

describe('AcrAdapter', () => {
  it('contributes empty capabilities when no snapshot', async () => {
    const adapter = new AcrAdapter({ getCapabilities: () => null });
    const result = await adapter.contribute({});
    expect(result.capabilities?.mounted).toEqual([]);
    expect(result.capabilities?.resolution).toEqual({});
    expect(result.capabilities?.budget_used).toBe(0);
    expect(result.capabilities?.budget_limit).toBe(0);
  });

  it('contributes mounted capabilities and resolution levels', async () => {
    const adapter = new AcrAdapter({
      getCapabilities: () => ({
        mounted: ['code-review', 'test-runner'],
        resolution: { 'code-review': 'standard', 'test-runner': 'summary' },
        budget_used: 1200,
        budget_limit: 8000,
      }),
    });
    const result = await adapter.contribute({});
    expect(result.capabilities?.mounted).toEqual(['code-review', 'test-runner']);
    expect(result.capabilities?.resolution['code-review']).toBe('standard');
    expect(result.capabilities?.resolution['test-runner']).toBe('summary');
  });

  it('contributes budget usage correctly', async () => {
    const adapter = new AcrAdapter({
      getCapabilities: () => ({
        mounted: ['deep-research'],
        resolution: { 'deep-research': 'deep' },
        budget_used: 4800,
        budget_limit: 8000,
      }),
    });
    const result = await adapter.contribute({});
    expect(result.capabilities?.budget_used).toBe(4800);
    expect(result.capabilities?.budget_limit).toBe(8000);
  });

  it('preserves other event fields', async () => {
    const adapter = new AcrAdapter({ getCapabilities: () => null });
    const result = await adapter.contribute({ agent_id: 'agent-xyz' });
    expect(result.agent_id).toBe('agent-xyz');
  });

  it('observe is a no-op', async () => {
    const adapter = new AcrAdapter({ getCapabilities: () => null });
    await expect(adapter.observe({} as never)).resolves.toBeUndefined();
  });
});
