/**
 * Spec 2 acceptance tests (Task 11).
 *
 * Fills the remaining gaps from the §11 checklist:
 *   - Redaction PII triad (email + phone + SSN).
 *   - Concurrent emit (10 parallel calls, unforked chain).
 *
 * (Happy-path-50, tampered-middle/head, missing-event, must-not-redact,
 *  cross-version, and anchor-determinism live alongside their primary
 *  modules.)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRuntime } from '../runtime.js';
import { verifyChain, loadPublicKeyFromBase64 } from '../verify-chain.js';

describe('Spec 2 — redaction PII triad', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sonder-pii-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const mk = () => createRuntime({ keyPath: join(dir, 'key'), dbPath: join(dir, 'audit.db') });

  it('email + phone + SSN are all masked in the persisted event', async () => {
    const runtime = mk();
    // Phone format matches the vendored pattern: \d{3}[-.\s]?\d{3}[-.\s]?\d{4}
    // (single-char separator). E.164-style "(415) " parens are out of scope
    // for the inlined pattern — operators wanting that can supply their own.
    const e = await runtime.emit({
      agent_id: 'a',
      task_id: 't',
      payload: {
        email: 'alice@example.com',
        phone: '415-555-2671',
        ssn: '123-45-6789',
        note: 'leave PII out of logs',
      },
    });

    const ser = JSON.stringify(e.payload);
    expect(ser).not.toContain('alice@example.com');
    expect(ser).not.toContain('123-45-6789');
    expect(ser).not.toContain('415-555-2671');

    // metadata.redaction reports the masked paths + count.
    expect(e.metadata.redaction.count).toBeGreaterThanOrEqual(3);
    expect(e.metadata.redaction.fields.length).toBe(e.metadata.redaction.count);

    // Signature still verifies (sig is over the masked event).
    const pubKey = loadPublicKeyFromBase64(runtime.publicKey);
    const result = verifyChain({ audit: runtime.bus.audit, agentId: 'a', publicKey: pubKey });
    expect(result.status).toBe('pass');

    runtime.shutdown();
  });
});

describe('Spec 2 — concurrent emit (R6)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sonder-conc-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const mk = () => createRuntime({ keyPath: join(dir, 'key'), dbPath: join(dir, 'audit.db') });

  it('10 parallel emits for the same agent produce a linear, unforked chain', async () => {
    const runtime = mk();
    const N = 10;

    const settled = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        runtime.emit({ agent_id: 'agent-c', task_id: 't', payload: { n: i } }),
      ),
    );

    // 1) All 10 succeeded.
    expect(settled).toHaveLength(N);

    // 2) Read back in chain order and assert each link.
    const events = runtime.bus.audit.queryByAgent('agent-c');
    expect(events).toHaveLength(N);

    // 3) Every event has unique chain_self_hash (no duplicate writes).
    const seenSelf = new Set(events.map((e) => e.version === '2' ? e.chain_self_hash : ''));
    expect(seenSelf.size).toBe(N);

    // 4) Chain is linear — verifyChain passes end-to-end.
    const pubKey = loadPublicKeyFromBase64(runtime.publicKey);
    const result = verifyChain({ audit: runtime.bus.audit, agentId: 'agent-c', publicKey: pubKey });
    expect(result.status).toBe('pass');
    if (result.status === 'pass') {
      expect(result.eventsChecked).toBe(N);
    }

    runtime.shutdown();
  });

  it('concurrent emits across distinct agents do not interfere', async () => {
    const runtime = mk();
    const N = 5;
    const A = ['agent-a', 'agent-b', 'agent-c'];

    const tasks: Promise<unknown>[] = [];
    for (const agent of A) {
      for (let i = 0; i < N; i++) {
        tasks.push(runtime.emit({ agent_id: agent, task_id: 't', payload: { n: i } }));
      }
    }
    await Promise.all(tasks);

    const pubKey = loadPublicKeyFromBase64(runtime.publicKey);
    for (const agent of A) {
      const result = verifyChain({ audit: runtime.bus.audit, agentId: agent, publicKey: pubKey });
      expect(result.status).toBe('pass');
      if (result.status === 'pass') {
        expect(result.eventsChecked).toBe(N);
      }
    }
    runtime.shutdown();
  });
});
