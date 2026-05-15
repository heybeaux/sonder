/**
 * Spike A.5 — pre-emit approval gate.
 *
 * Proves the architecture decision from Spike A:
 *   - Sonder owns the mechanism (this pipeline aborts before persistence)
 *   - Adapters own the policy (Lattice / AWM decide when to gate)
 *   - The cockpit (Ginnung) resolves gates out-of-band and retries
 *
 * If these tests pass, the v1 Ginnung gate flow is implementable on top
 * of the current Sonder bus without a bus rewrite.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRuntime } from '../runtime.js';
import {
  GatePendingError,
  type ApprovalGate,
  type SonderAdapter,
  type SonderEventCore,
} from '@heybeaux/sonder-core';

/** Minimal adapter that exposes a settable gate, for tests. */
class MockGateAdapter implements SonderAdapter {
  readonly name = 'mock-gate';
  readonly version = '0.0.1-spike';
  gate: ApprovalGate | null = null;

  async contribute(event: Partial<SonderEventCore>): Promise<Partial<SonderEventCore>> {
    return event;
  }
  async observe(): Promise<void> {}
  async checkGate(): Promise<ApprovalGate | null> {
    return this.gate;
  }
}

describe('Spike A.5 — pre-emit approval gate', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sonder-gate-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const mk = () =>
    createRuntime({ keyPath: join(dir, 'key'), dbPath: join(dir, 'audit.db') });

  it('emits normally when no adapter opens a gate', async () => {
    const runtime = mk();
    const adapter = new MockGateAdapter();
    runtime.bus.register(adapter);

    const e = await runtime.emit({ agent_id: 'a', task_id: 't', payload: 'hi' });
    expect(e.version).toBe('2');
    runtime.shutdown();
  });

  it('aborts emit and throws GatePendingError when a gate is pending', async () => {
    const runtime = mk();
    const adapter = new MockGateAdapter();
    adapter.gate = {
      state: 'pending',
      gate_id: 'gate_001',
      reason: 'capability=gh.pr.review needs human approval',
      default_action: 'deny',
    };
    runtime.bus.register(adapter);

    await expect(
      runtime.emit({ agent_id: 'a', task_id: 't', payload: 'sensitive' }),
    ).rejects.toBeInstanceOf(GatePendingError);
  });

  it('writes NO audit row when a gate aborts emit', async () => {
    const runtime = mk();
    const adapter = new MockGateAdapter();
    adapter.gate = {
      state: 'pending',
      gate_id: 'gate_002',
      default_action: 'deny',
    };
    runtime.bus.register(adapter);

    await expect(
      runtime.emit({ agent_id: 'a', task_id: 't', payload: 'sensitive' }),
    ).rejects.toBeInstanceOf(GatePendingError);

    const rows = runtime.bus.query({ agent_id: 'a' });
    expect(rows).toEqual([]);
    runtime.shutdown();
  });

  it('GatePendingError carries the adapter name and full gate', async () => {
    const runtime = mk();
    const adapter = new MockGateAdapter();
    const gate: ApprovalGate = {
      state: 'pending',
      gate_id: 'gate_003',
      reason: 'review needed',
      default_action: 'deny',
      expires_at: '2026-05-15T00:00:00Z',
    };
    adapter.gate = gate;
    runtime.bus.register(adapter);

    try {
      await runtime.emit({ agent_id: 'a', task_id: 't', payload: 'x' });
      throw new Error('expected gate error');
    } catch (err) {
      expect(err).toBeInstanceOf(GatePendingError);
      const gateErr = err as GatePendingError;
      expect(gateErr.adapterName).toBe('mock-gate');
      expect(gateErr.gate).toEqual(gate);
    }
    runtime.shutdown();
  });

  it('resume path: when gate flips to allowed, the retry succeeds', async () => {
    const runtime = mk();
    const adapter = new MockGateAdapter();
    adapter.gate = {
      state: 'pending',
      gate_id: 'gate_004',
      default_action: 'deny',
    };
    runtime.bus.register(adapter);

    // First attempt: gate is pending → abort
    await expect(
      runtime.emit({ agent_id: 'a', task_id: 't', payload: 'p' }),
    ).rejects.toBeInstanceOf(GatePendingError);

    // Cockpit resolves the gate out-of-band → adapter returns null (no opinion)
    adapter.gate = null;

    // Retry: succeeds, audit row written
    const e = await runtime.emit({ agent_id: 'a', task_id: 't', payload: 'p' });
    expect(e.version).toBe('2');
    const rows = runtime.bus.query({ agent_id: 'a' });
    expect(rows).toHaveLength(1);
    runtime.shutdown();
  });

  it('allowed gate does NOT abort the pipeline (records but proceeds)', async () => {
    const runtime = mk();
    const adapter = new MockGateAdapter();
    adapter.gate = {
      state: 'allowed',
      gate_id: 'gate_005',
      default_action: 'deny',
    };
    runtime.bus.register(adapter);

    const e = await runtime.emit({ agent_id: 'a', task_id: 't', payload: 'p' });
    expect(e.version).toBe('2');
    runtime.shutdown();
  });

  it('multiple adapters: first pending gate wins', async () => {
    const runtime = mk();
    const a1 = new MockGateAdapter();
    const a2 = new MockGateAdapter();
    a1.gate = null;
    a2.gate = {
      state: 'pending',
      gate_id: 'gate_006_from_a2',
      default_action: 'deny',
    };
    runtime.bus.register(a1);
    runtime.bus.register(a2);

    try {
      await runtime.emit({ agent_id: 'a', task_id: 't', payload: 'p' });
      throw new Error('expected gate error');
    } catch (err) {
      expect(err).toBeInstanceOf(GatePendingError);
      expect((err as GatePendingError).gate.gate_id).toBe('gate_006_from_a2');
    }
    runtime.shutdown();
  });
});
