/**
 * Verify-chain tests (Spec 2 Task 9 / R7 / R11).
 *
 * Happy path, tampered middle, tampered head, missing middle, v1 row mid-walk,
 * missing-data, and bad-genesis-seed scenarios.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AuditLog } from '@heybeaux/sonder-core';
import { createRuntime } from '../runtime.js';
import { verifyChain, loadPublicKeyFromBase64 } from '../verify-chain.js';

describe('verifyChain', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sonder-verify-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const mk = () =>
    createRuntime({ keyPath: join(dir, 'key'), dbPath: join(dir, 'audit.db') });

  it('happy path: 10-event chain verifies clean', async () => {
    const runtime = mk();
    for (let i = 0; i < 10; i++) {
      await runtime.emit({ agent_id: 'a', task_id: 't', payload: { n: i } });
    }

    const pubKey = loadPublicKeyFromBase64(runtime.publicKey);
    const result = verifyChain({ audit: runtime.bus.audit, agentId: 'a', publicKey: pubKey });

    expect(result.status).toBe('pass');
    if (result.status === 'pass') {
      expect(result.eventsChecked).toBe(10);
      expect(result.warnings).toEqual([]);
    }
    runtime.shutdown();
  });

  it('tampered middle: chain_self_hash mismatch at the offending event', async () => {
    const runtime = mk();
    for (let i = 0; i < 5; i++) {
      await runtime.emit({ agent_id: 'a', task_id: 't', payload: { n: i } });
    }

    // Flip a byte in the middle event's payload. We bypass the AuditLog
    // surface and mutate the row directly via rawDb().
    const db = runtime.bus.audit.rawDb();
    const rows = db
      .prepare(`SELECT id, payload FROM events WHERE agent_id='a' ORDER BY timestamp ASC, id ASC`)
      .all() as Array<{ id: string; payload: string }>;
    const middle = rows[2]!;
    const parsed = JSON.parse(middle.payload) as { payload: { n: number } };
    parsed.payload.n = 999; // tamper
    db.prepare(`UPDATE events SET payload = ? WHERE id = ?`).run(
      JSON.stringify(parsed),
      middle.id,
    );

    const pubKey = loadPublicKeyFromBase64(runtime.publicKey);
    const result = verifyChain({ audit: runtime.bus.audit, agentId: 'a', publicKey: pubKey });

    expect(result.status).toBe('mismatch');
    if (result.status === 'mismatch') {
      expect(result.mismatch.eventId).toBe(middle.id);
      expect(result.mismatch.check).toBe('chain_self_hash');
      expect(result.mismatch.index).toBe(2);
    }
    runtime.shutdown();
  });

  it('tampered head: mismatch fires at the head event', async () => {
    const runtime = mk();
    for (let i = 0; i < 5; i++) {
      await runtime.emit({ agent_id: 'a', task_id: 't', payload: { n: i } });
    }

    const db = runtime.bus.audit.rawDb();
    const rows = db
      .prepare(`SELECT id, payload FROM events WHERE agent_id='a' ORDER BY timestamp ASC, id ASC`)
      .all() as Array<{ id: string; payload: string }>;
    const head = rows[4]!;
    const parsed = JSON.parse(head.payload) as { payload: { n: number } };
    parsed.payload.n = 7777;
    db.prepare(`UPDATE events SET payload = ? WHERE id = ?`).run(
      JSON.stringify(parsed),
      head.id,
    );

    const pubKey = loadPublicKeyFromBase64(runtime.publicKey);
    const result = verifyChain({ audit: runtime.bus.audit, agentId: 'a', publicKey: pubKey });

    expect(result.status).toBe('mismatch');
    if (result.status === 'mismatch') {
      expect(result.mismatch.eventId).toBe(head.id);
      expect(result.mismatch.check).toBe('chain_self_hash');
      expect(result.mismatch.index).toBe(4);
    }
    runtime.shutdown();
  });

  it('missing event: deleting a middle row produces a chain_prev_hash mismatch', async () => {
    const runtime = mk();
    for (let i = 0; i < 5; i++) {
      await runtime.emit({ agent_id: 'a', task_id: 't', payload: { n: i } });
    }

    const db = runtime.bus.audit.rawDb();
    const rows = db
      .prepare(`SELECT id FROM events WHERE agent_id='a' ORDER BY timestamp ASC, id ASC`)
      .all() as Array<{ id: string }>;
    const middle = rows[2]!;
    db.prepare(`DELETE FROM events WHERE id = ?`).run(middle.id);

    const pubKey = loadPublicKeyFromBase64(runtime.publicKey);
    const result = verifyChain({ audit: runtime.bus.audit, agentId: 'a', publicKey: pubKey });

    expect(result.status).toBe('mismatch');
    if (result.status === 'mismatch') {
      expect(result.mismatch.check).toBe('chain_prev_hash');
      // The event AFTER the deletion is where the break surfaces.
      expect(result.mismatch.index).toBe(2);
    }
    runtime.shutdown();
  });

  it('signature tamper: forging chain_self_hash without re-signing trips the signature check', async () => {
    const runtime = mk();
    await runtime.emit({ agent_id: 'a', task_id: 't', payload: { n: 0 } });
    await runtime.emit({ agent_id: 'a', task_id: 't', payload: { n: 1 } });

    const db = runtime.bus.audit.rawDb();
    const rows = db
      .prepare(`SELECT id, payload FROM events WHERE agent_id='a' ORDER BY timestamp ASC, id ASC`)
      .all() as Array<{ id: string; payload: string }>;
    const target = rows[1]!;
    const parsed = JSON.parse(target.payload) as {
      payload: { n: number };
      chain_self_hash: string;
    };
    // Tamper payload, recompute the chain_self_hash so it passes (1), but
    // leave the old signature in place — (2) should fail.
    parsed.payload.n = 42;
    const { chainSelfHash } = await import('@heybeaux/sonder-core');
    parsed.chain_self_hash = chainSelfHash(parsed as unknown as Record<string, unknown>);
    db.prepare(`UPDATE events SET payload = ?, chain_self_hash = ? WHERE id = ?`).run(
      JSON.stringify(parsed),
      parsed.chain_self_hash,
      target.id,
    );

    const pubKey = loadPublicKeyFromBase64(runtime.publicKey);
    const result = verifyChain({ audit: runtime.bus.audit, agentId: 'a', publicKey: pubKey });
    expect(result.status).toBe('mismatch');
    if (result.status === 'mismatch') {
      expect(result.mismatch.check).toBe('signature');
    }
    runtime.shutdown();
  });

  it('missing agent: returns status="missing"', async () => {
    const runtime = mk();
    await runtime.emit({ agent_id: 'a', task_id: 't', payload: null });
    const pubKey = loadPublicKeyFromBase64(runtime.publicKey);
    const result = verifyChain({ audit: runtime.bus.audit, agentId: 'nobody', publicKey: pubKey });
    expect(result.status).toBe('missing');
    runtime.shutdown();
  });

  it('v1 mid-walk: surfaces a warning and continues, not a chain break', async () => {
    const runtime = mk();
    // Emit two v2 events.
    await runtime.emit({ agent_id: 'a', task_id: 't', payload: { n: 0 } });
    await runtime.emit({ agent_id: 'a', task_id: 't', payload: { n: 1 } });

    // Inject a v1 row mid-stream.
    const db = runtime.bus.audit.rawDb();
    const middleTs = '2026-05-12T01:00:00.000Z'; // earlier than emit timestamps in 2026-05-12 today
    // Place it between the two v2 events by inspecting their timestamps.
    const ordered = db
      .prepare(`SELECT id, timestamp FROM events WHERE agent_id='a' ORDER BY timestamp ASC, id ASC`)
      .all() as Array<{ id: string; timestamp: string }>;
    // Sandwich a v1 row temporally between first and second event by
    // computing a timestamp midway. Easier: just use first.ts + 1ms.
    const first = ordered[0]!;
    const t = new Date(first.timestamp).getTime() + 1;
    const tsMid = new Date(t).toISOString();
    const v1Row = {
      id: 'legacy-1',
      version: '1',
      agent_id: 'a',
      task_id: 't',
      timestamp: tsMid,
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
      payload: 'legacy',
    };
    db.prepare(
      `INSERT INTO events (id, agent_id, task_id, timestamp, version, validated, violations, payload)
       VALUES (@id, @agent_id, @task_id, @timestamp, '1', 1, '[]', @payload)`,
    ).run({
      id: v1Row.id,
      agent_id: v1Row.agent_id,
      task_id: v1Row.task_id,
      timestamp: v1Row.timestamp,
      payload: JSON.stringify(v1Row),
    });
    void middleTs;

    const pubKey = loadPublicKeyFromBase64(runtime.publicKey);
    const result = verifyChain({ audit: runtime.bus.audit, agentId: 'a', publicKey: pubKey });

    expect(result.status).toBe('pass');
    if (result.status === 'pass') {
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]?.kind).toBe('v1-skipped');
      expect(result.warnings[0]?.eventId).toBe('legacy-1');
      expect(result.eventsChecked).toBe(2);
    }
    runtime.shutdown();
  });

  it('only-v1: returns missing with the v1-only reason', () => {
    const audit = new AuditLog();
    // Insert a v1-only row directly.
    audit.write({
      id: 'legacy-1',
      version: '1',
      agent_id: 'a',
      task_id: 't',
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
      payload: 'legacy',
    });

    // Synth a public key — won't be used (we expect missing).
    const synth = createRuntime({
      keyPath: join(mkdtempSync(join(tmpdir(), 'sonder-keyonly-')), 'key'),
      dbPath: ':memory:',
    });
    const pubKey = loadPublicKeyFromBase64(synth.publicKey);
    const result = verifyChain({ audit, agentId: 'a', publicKey: pubKey });
    expect(result.status).toBe('missing');
    if (result.status === 'missing') {
      expect(result.reason).toMatch(/no v2 events/);
    }
    audit.close();
    synth.shutdown();
  });
});
