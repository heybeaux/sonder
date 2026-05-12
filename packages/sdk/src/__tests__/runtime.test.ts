import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRuntime } from '../runtime.js';
import type { SonderAdapter, SonderEventCore } from '@heybeaux/sonder-core';

function mockAdapter(name: string, patch: Partial<SonderEventCore> = {}): SonderAdapter {
  return {
    name,
    version: '0.0.1',
    contribute: vi.fn(async (e) => ({ ...e, ...patch })),
    observe: vi.fn(async () => {}),
  };
}

describe('createRuntime', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sonder-runtime-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const mk = (cfg: Parameters<typeof createRuntime>[0] = {}) =>
    createRuntime({ keyPath: join(dir, 'key'), dbPath: join(dir, 'audit.db'), ...cfg });

  it('returns a bus, emit, publicKey, and shutdown', () => {
    const runtime = mk();
    expect(runtime.bus).toBeDefined();
    expect(typeof runtime.emit).toBe('function');
    expect(runtime.publicKey).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(typeof runtime.shutdown).toBe('function');
    runtime.shutdown();
  });

  it('registers adapters onto the bus', async () => {
    const adapter = mockAdapter('test');
    const runtime = mk({ adapters: [adapter] });

    await runtime.emit({ agent_id: 'a', task_id: 't', payload: null });
    expect(adapter.contribute).toHaveBeenCalledOnce();

    runtime.shutdown();
  });

  it('registers multiple adapters in order', async () => {
    const calls: string[] = [];
    const a1: SonderAdapter = { name: 'first', version: '1', contribute: async (e) => { calls.push('first'); return e; }, observe: async () => {} };
    const a2: SonderAdapter = { name: 'second', version: '1', contribute: async (e) => { calls.push('second'); return e; }, observe: async () => {} };

    const runtime = mk({ adapters: [a1, a2] });
    await runtime.emit({ agent_id: 'a', task_id: 't', payload: null });

    expect(calls).toContain('first');
    expect(calls).toContain('second');
    runtime.shutdown();
  });

  it('works with no adapters', async () => {
    const runtime = mk();
    const event = await runtime.emit({ agent_id: 'a', task_id: 't', payload: 'hello' });
    expect(event.agent_id).toBe('a');
    expect(event.payload).toBe('hello');
    expect(event.version).toBe('2');
    expect(event.chain_self_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(event.signature).toMatch(/^[A-Za-z0-9+/=]+$/);
    runtime.shutdown();
  });
});
