/**
 * Emit-pipeline tests (Spec 2 Task 7).
 *
 * Asserts the pipeline order, that failures mid-pipeline do NOT persist,
 * and that the v2 envelope is well-formed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRuntime } from '../runtime.js';
import {
  publicKeyFromRawBase64,
  verify,
  chainSelfHash,
  DEFAULT_MUST_NOT_REDACT,
  type SonderEventV2,
} from '@heybeaux/sonder-core';

describe('Emit pipeline — v2 envelope structure', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sonder-pipeline-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const mk = (cfg: Parameters<typeof createRuntime>[0] = {}) =>
    createRuntime({ keyPath: join(dir, 'key'), dbPath: join(dir, 'audit.db'), ...cfg });

  it('emits a fully-formed v2 event with chain hashes + signature', async () => {
    const runtime = mk();
    const e = await runtime.emit({ agent_id: 'a', task_id: 't', payload: 'hello' });
    expect(e.version).toBe('2');
    expect(e.chain_prev_hash).toMatch(/^genesis:a:/);
    expect(e.chain_self_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(e.signature).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(e.metadata.redaction).toEqual({
      fields: [],
      count: 0,
      sensitivityLevel: 'high',
    });
    runtime.shutdown();
  });

  it('signature verifies with the runtime public key', async () => {
    const runtime = mk();
    const e = await runtime.emit({ agent_id: 'a', task_id: 't', payload: 'hello' });
    const pubKey = publicKeyFromRawBase64(runtime.publicKey);
    expect(verify(e as unknown as Record<string, unknown>, pubKey)).toBe(true);
    runtime.shutdown();
  });

  it('chain_self_hash is consistent — recomputing reproduces the value', async () => {
    const runtime = mk();
    const e = await runtime.emit({ agent_id: 'a', task_id: 't', payload: 'hello' });
    const recomputed = chainSelfHash(e as unknown as Record<string, unknown>);
    expect(recomputed).toBe(e.chain_self_hash);
    runtime.shutdown();
  });

  it('second event links to the first via chain_prev_hash', async () => {
    const runtime = mk();
    const e1 = await runtime.emit({ agent_id: 'a', task_id: 't', payload: 'one' });
    const e2 = await runtime.emit({ agent_id: 'a', task_id: 't', payload: 'two' });
    expect(e2.chain_prev_hash).toBe(e1.chain_self_hash);
    runtime.shutdown();
  });

  it('different agents have independent chains', async () => {
    const runtime = mk();
    const a = await runtime.emit({ agent_id: 'agent-a', task_id: 't', payload: 1 });
    const b = await runtime.emit({ agent_id: 'agent-b', task_id: 't', payload: 1 });
    expect(a.chain_prev_hash).toMatch(/^genesis:agent-a:/);
    expect(b.chain_prev_hash).toMatch(/^genesis:agent-b:/);
    runtime.shutdown();
  });

  it('payload PII is redacted before signing — signature is over the masked event', async () => {
    const runtime = mk();
    const e = await runtime.emit({
      agent_id: 'a',
      task_id: 't',
      payload: { contact: 'alice@example.com' },
    });
    expect(JSON.stringify(e.payload)).not.toContain('alice@example.com');
    expect(e.metadata.redaction.count).toBeGreaterThan(0);
    const pubKey = publicKeyFromRawBase64(runtime.publicKey);
    expect(verify(e as unknown as Record<string, unknown>, pubKey)).toBe(true);
    runtime.shutdown();
  });
});

describe('Emit pipeline — failure modes', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sonder-pipeline-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const mk = (cfg: Parameters<typeof createRuntime>[0] = {}) =>
    createRuntime({ keyPath: join(dir, 'key'), dbPath: join(dir, 'audit.db'), ...cfg });

  it('refuses when L1 tier is claimed with empty evidence — l0-evidence-missing', async () => {
    // Provide `evidence: []` so the must-not-redact gate (which only checks
    // presence) passes, and we land on validateL0EvidenceOrThrow.
    const runtime = mk({
      adapters: [
        {
          name: 'fake-lattice',
          version: '1',
          contribute: async (e) => ({
            ...e,
            governance: {
              contract_id: 'c',
              validated: true,
              l1_pass: true,
              l2_pass: true,
              l3_pass: true,
              violations: [],
              circuit_state: 'closed' as const,
              tier: 'L0+L1',
              evidence: [],
            },
          }),
          observe: async () => {},
        },
      ],
    });

    await expect(
      runtime.emit({ agent_id: 'a', task_id: 't', payload: 'x' }),
    ).rejects.toThrow(/l0-evidence-missing/);

    // Audit log should be empty — event was not persisted.
    expect(runtime.bus.query({ agent_id: 'a' })).toHaveLength(0);
    runtime.shutdown();
  });

  it('refuses when L1 tier is claimed and evidence field is missing — must-not-redact', async () => {
    // When `tier` is set but `evidence` is absent, the must-not-redact gate
    // fires first (evidence becomes a conditional required path).
    const runtime = mk({
      adapters: [
        {
          name: 'fake-lattice',
          version: '1',
          contribute: async (e) => ({
            ...e,
            governance: {
              contract_id: 'c',
              validated: true,
              l1_pass: true,
              l2_pass: true,
              l3_pass: true,
              violations: [],
              circuit_state: 'closed' as const,
              tier: 'L0+L1',
              // evidence absent
            },
          }),
          observe: async () => {},
        },
      ],
    });

    await expect(
      runtime.emit({ agent_id: 'a', task_id: 't', payload: 'x' }),
    ).rejects.toThrow(/must-not-redact-field-missing:\$\.governance\.evidence/);

    // Audit log should be empty — event was not persisted.
    expect(runtime.bus.query({ agent_id: 'a' })).toHaveLength(0);
    runtime.shutdown();
  });

  it('refuses when an audit-critical field would be redacted away', async () => {
    const runtime = mk();
    // governance.contract_id with a value that the OpenAI pattern would
    // redact. Force it via an adapter so the bus sees it.
    const adapter = {
      name: 'evil',
      version: '1',
      contribute: async (e: Partial<unknown>) => ({
        ...(e as object),
        governance: {
          contract_id: 'sk-proj-abcdefghijklmnopqrstuvwxyz1234567890',
          validated: true,
          l1_pass: true,
          l2_pass: true,
          l3_pass: true,
          violations: [],
          circuit_state: 'closed',
        },
      }),
      observe: async () => {},
    };
    runtime.bus.register(adapter as never);

    await expect(
      runtime.emit({ agent_id: 'a', task_id: 't', payload: 'x' }),
    ).rejects.toThrow(/must-not-redact-field-missing/);

    // No row persisted.
    expect(runtime.bus.query({ agent_id: 'a' })).toHaveLength(0);
    runtime.shutdown();
  });

  it('throws at construction when mustNotRedact override removes a default', () => {
    expect(() =>
      mk({
        redaction: {
          mustNotRedact: DEFAULT_MUST_NOT_REDACT.filter((p) => p !== '$.agent_id'),
        },
      }),
    ).toThrow(/must-not-redact override removed required path/);
  });

  it('accepts mustNotRedact override that supersets the defaults', () => {
    expect(() =>
      mk({
        redaction: {
          mustNotRedact: [...DEFAULT_MUST_NOT_REDACT, '$.payload.contract_hash'],
        },
      }),
    ).not.toThrow();
  });
});

describe('Emit pipeline — chain integrity over 50 events', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sonder-pipeline-50-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('50-event chain links cleanly + every signature verifies', async () => {
    const runtime = createRuntime({
      keyPath: join(dir, 'key'),
      dbPath: join(dir, 'audit.db'),
    });
    const pubKey = publicKeyFromRawBase64(runtime.publicKey);

    const emitted: SonderEventV2[] = [];
    for (let i = 0; i < 50; i++) {
      emitted.push(
        await runtime.emit({
          agent_id: 'agent-50',
          task_id: 't',
          payload: { n: i },
        }),
      );
    }

    // First event: genesis prev.
    expect(emitted[0]?.chain_prev_hash).toMatch(/^genesis:agent-50:/);

    // Each event links to its predecessor.
    for (let i = 1; i < 50; i++) {
      expect(emitted[i]?.chain_prev_hash).toBe(emitted[i - 1]?.chain_self_hash);
    }

    // Every signature verifies.
    for (const e of emitted) {
      expect(verify(e as unknown as Record<string, unknown>, pubKey)).toBe(true);
    }

    runtime.shutdown();
  });
});
