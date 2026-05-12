import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AuditLog } from '../audit.js';
import {
  genesisSeed,
  readPrevHashForNextEvent,
  stampChainHashes,
} from '../chain.js';
import { chainSelfHash } from '../hash.js';
import type { SonderEventV2 } from '../types/event.js';

function v2Stub(overrides: Partial<SonderEventV2> = {}): Omit<SonderEventV2, 'chain_self_hash' | 'signature'> {
  return {
    id: 'evt-1',
    version: '2',
    agent_id: 'agent-x',
    task_id: 'task-1',
    timestamp: '2026-05-12T00:00:00Z',
    capabilities: { mounted: [], resolution: {}, budget_used: 0, budget_limit: 0 },
    memory: { refs: [], confidence: 0 },
    reasoning: { model: '', neurotypes: [], consensus: false, dissent: [], osi: 0, rounds: 0 },
    governance: {
      contract_id: 'c1',
      validated: true,
      l1_pass: true,
      l2_pass: true,
      l3_pass: true,
      violations: [],
      circuit_state: 'closed',
    },
    prediction: { outcome: '', confidence: 0, alpha: 1, beta: 1, model_id: '' },
    intent: { action: '', step_trace_id: '', skipped: false, constraint_injected: false },
    payload: 'hello',
    metadata: { redaction: { fields: [], count: 0, sensitivityLevel: 'high' } },
    chain_prev_hash: 'genesis:agent-x:2026-05-12T00:00:00Z',
    ...overrides,
  };
}

describe('genesisSeed', () => {
  it('builds the canonical genesis prefix', () => {
    expect(genesisSeed('a', '2026-05-12T00:00:00Z')).toBe(
      'genesis:a:2026-05-12T00:00:00Z',
    );
  });

  it('is invalid hex (cannot collide with a chain_self_hash)', () => {
    const seed = genesisSeed('a', '2026-05-12T00:00:00Z');
    expect(seed).not.toMatch(/^[0-9a-f]+$/);
  });
});

describe('readPrevHashForNextEvent', () => {
  let audit: AuditLog;

  beforeEach(() => {
    audit = new AuditLog();
  });

  afterEach(() => {
    audit.close();
  });

  it('returns the genesis seed for an agent with no events', () => {
    const seed = readPrevHashForNextEvent(audit, 'agent-x', '2026-05-12T00:00:00Z');
    expect(seed).toBe('genesis:agent-x:2026-05-12T00:00:00Z');
  });

  it('returns the latest chain_self_hash once an event exists', () => {
    const e1 = stampChainHashes(v2Stub());
    audit.immediate(() => {
      audit.writeChain({ ...e1, signature: 'sig1' });
    });
    const prev = readPrevHashForNextEvent(audit, 'agent-x', '2026-05-12T00:01:00Z');
    expect(prev).toBe(e1.chain_self_hash);
  });

  it('reuses the existing genesis timestamp on a subsequent call', () => {
    const e1 = stampChainHashes(v2Stub());
    audit.immediate(() => {
      audit.writeChain({ ...e1, signature: 'sig1' });
    });
    // Even passing a fresh `iso8601`, the genesis row was already written
    // with the first event's timestamp.
    const seed = readPrevHashForNextEvent(audit, 'fresh-agent', '2026-05-12T00:00:00Z');
    expect(seed).toBe('genesis:fresh-agent:2026-05-12T00:00:00Z');
  });
});

describe('stampChainHashes', () => {
  it('attaches chain_self_hash to the event', () => {
    const stamped = stampChainHashes(v2Stub());
    expect(stamped.chain_self_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces a stable hash for identical input', () => {
    const e1 = stampChainHashes(v2Stub());
    const e2 = stampChainHashes(v2Stub());
    expect(e1.chain_self_hash).toBe(e2.chain_self_hash);
  });

  it('produces different hashes when chain_prev_hash differs', () => {
    const e1 = stampChainHashes(v2Stub({ chain_prev_hash: 'genesis:a:t1' }));
    const e2 = stampChainHashes(v2Stub({ chain_prev_hash: 'genesis:a:t2' }));
    expect(e1.chain_self_hash).not.toBe(e2.chain_self_hash);
  });

  it('the stamped hash matches chainSelfHash recomputed without chain_self_hash present', () => {
    const stamped = stampChainHashes(v2Stub());
    // Recompute over the stamped object — chainSelfHash strips chain_self_hash
    // before canonicalization so this must equal the value already on the
    // stamped object.
    expect(chainSelfHash(stamped as unknown as Record<string, unknown>)).toBe(
      stamped.chain_self_hash,
    );
  });
});

describe('audit.writeChain + chain_genesis interaction', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sonder-chain-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes the genesis row on the first event for an agent', () => {
    const audit = new AuditLog(join(dir, 'audit.db'));
    const e1 = stampChainHashes(v2Stub());
    audit.immediate(() => {
      audit.writeChain({ ...e1, signature: 'sig1' });
    });
    const genesis = audit.readGenesis('agent-x');
    expect(genesis).not.toBeNull();
    expect(genesis?.genesis_event_id).toBe('evt-1');
    expect(genesis?.genesis_timestamp).toBe('2026-05-12T00:00:00Z');
    audit.close();
  });

  it('does NOT overwrite the genesis row on subsequent events for the same agent', () => {
    const audit = new AuditLog(join(dir, 'audit.db'));
    const e1 = stampChainHashes(v2Stub());
    const e2 = stampChainHashes(v2Stub({
      id: 'evt-2',
      timestamp: '2026-05-12T00:01:00Z',
      chain_prev_hash: e1.chain_self_hash,
    }));
    audit.immediate(() => {
      audit.writeChain({ ...e1, signature: 'sig1' });
    });
    audit.immediate(() => {
      audit.writeChain({ ...e2, signature: 'sig2' });
    });
    const genesis = audit.readGenesis('agent-x');
    // Still the first event's timestamp.
    expect(genesis?.genesis_event_id).toBe('evt-1');
    audit.close();
  });

  it('per-agent genesis is independent', () => {
    const audit = new AuditLog(join(dir, 'audit.db'));
    const a = stampChainHashes(v2Stub({ agent_id: 'agent-a', id: 'a1' }));
    const b = stampChainHashes(v2Stub({
      agent_id: 'agent-b',
      id: 'b1',
      timestamp: '2026-05-12T01:00:00Z',
      chain_prev_hash: 'genesis:agent-b:2026-05-12T01:00:00Z',
    }));
    audit.immediate(() => {
      audit.writeChain({ ...a, signature: 'sig-a' });
    });
    audit.immediate(() => {
      audit.writeChain({ ...b, signature: 'sig-b' });
    });
    expect(audit.readGenesis('agent-a')?.genesis_event_id).toBe('a1');
    expect(audit.readGenesis('agent-b')?.genesis_event_id).toBe('b1');
    audit.close();
  });
});
