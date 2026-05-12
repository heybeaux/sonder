import { describe, it, expect, vi } from 'vitest';
import { createRuntime } from '../runtime.js';
import type { SonderAdapter, SonderEvent } from '@heybeaux/sonder-core';

function mockAdapter(name: string, patch: Partial<SonderEvent> = {}): SonderAdapter {
  return {
    name,
    version: '0.0.1',
    contribute: vi.fn(async (e) => ({ ...e, ...patch })),
    observe: vi.fn(async () => {}),
  };
}

describe('createRuntime', () => {
  it('returns a bus and shutdown function', () => {
    const runtime = createRuntime();
    expect(runtime.bus).toBeDefined();
    expect(typeof runtime.shutdown).toBe('function');
    runtime.shutdown();
  });

  it('registers adapters onto the bus', async () => {
    const adapter = mockAdapter('test');
    const runtime = createRuntime({ adapters: [adapter] });

    await runtime.bus.emit({ agent_id: 'a', task_id: 't', payload: null });
    expect(adapter.contribute).toHaveBeenCalledOnce();

    runtime.shutdown();
  });

  it('registers multiple adapters in order', async () => {
    const calls: string[] = [];
    const a1: SonderAdapter = { name: 'first', version: '1', contribute: async (e) => { calls.push('first'); return e; }, observe: async () => {} };
    const a2: SonderAdapter = { name: 'second', version: '1', contribute: async (e) => { calls.push('second'); return e; }, observe: async () => {} };

    const runtime = createRuntime({ adapters: [a1, a2] });
    await runtime.bus.emit({ agent_id: 'a', task_id: 't', payload: null });

    expect(calls).toContain('first');
    expect(calls).toContain('second');
    runtime.shutdown();
  });

  it('works with no adapters', async () => {
    const runtime = createRuntime();
    const event = await runtime.bus.emit({ agent_id: 'a', task_id: 't', payload: 'hello' });
    expect(event.agent_id).toBe('a');
    expect(event.payload).toBe('hello');
    runtime.shutdown();
  });
});
