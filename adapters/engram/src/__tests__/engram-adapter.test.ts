import { describe, it, expect } from 'vitest';
import { EngramAdapter } from '../index.js';

describe('EngramAdapter', () => {
  it('contributes empty memory when no retrieval has occurred', async () => {
    const adapter = new EngramAdapter({ getLastRetrieval: () => null });
    const result = await adapter.contribute({});
    expect(result.memory?.refs).toEqual([]);
    expect(result.memory?.confidence).toBe(0);
    expect(result.memory?.query).toBeUndefined();
    expect(result.memory?.dream_cycle).toBeUndefined();
  });

  it('contributes refs and confidence from retrieval snapshot', async () => {
    const adapter = new EngramAdapter({
      getLastRetrieval: () => ({
        refs: ['mem-001', 'mem-002'],
        confidence: 0.87,
      }),
    });
    const result = await adapter.contribute({});
    expect(result.memory?.refs).toEqual(['mem-001', 'mem-002']);
    expect(result.memory?.confidence).toBe(0.87);
  });

  it('contributes query when present in snapshot', async () => {
    const adapter = new EngramAdapter({
      getLastRetrieval: () => ({
        refs: ['mem-003'],
        query: 'what did we decide about auth?',
        confidence: 0.91,
      }),
    });
    const result = await adapter.contribute({});
    expect(result.memory?.query).toBe('what did we decide about auth?');
  });

  it('contributes dream_cycle when present in snapshot', async () => {
    const adapter = new EngramAdapter({
      getLastRetrieval: () => ({
        refs: ['mem-004'],
        confidence: 0.75,
        dream_cycle: 'cycle-2026-05-09T02:00:00Z',
      }),
    });
    const result = await adapter.contribute({});
    expect(result.memory?.dream_cycle).toBe('cycle-2026-05-09T02:00:00Z');
  });

  it('omits optional fields when not in snapshot', async () => {
    const adapter = new EngramAdapter({
      getLastRetrieval: () => ({
        refs: [],
        confidence: 0,
      }),
    });
    const result = await adapter.contribute({});
    expect(result.memory?.query).toBeUndefined();
    expect(result.memory?.dream_cycle).toBeUndefined();
  });

  it('preserves other event fields unchanged', async () => {
    const adapter = new EngramAdapter({ getLastRetrieval: () => null });
    const result = await adapter.contribute({ agent_id: 'agent-xyz' });
    expect(result.agent_id).toBe('agent-xyz');
  });

  it('observe is a no-op', async () => {
    const adapter = new EngramAdapter({ getLastRetrieval: () => null });
    await expect(adapter.observe({} as never)).resolves.toBeUndefined();
  });
});
