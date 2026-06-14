/**
 * AuditLog reads (Spec 2 Task 8).
 *
 * Covers queryByAgent ordering, from/limit options, mixed v1+v2 reads,
 * listV2Agents enumeration, and head event lookup.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { AuditLog } from '../audit.js';
import type { SonderEventV1, SonderEventV2 } from '../types/event.js';

const baseCore = {
  capabilities: { mounted: [], resolution: {}, budget_used: 0, budget_limit: 0 },
  memory: { refs: [], confidence: 0 },
  reasoning: { model: '', neurotypes: [], consensus: false, dissent: [], osi: 0, rounds: 0 },
  governance: {
    contract_id: 'c1',
    validated: true,
    l1_pass: true,
    l2_pass: true,
    l3_pass: true,
    violations: [] as string[],
    circuit_state: 'closed' as const,
  },
  prediction: { outcome: '', confidence: 0, alpha: 1, beta: 1, model_id: '' },
  intent: { action: '', step_trace_id: '', skipped: false, constraint_injected: false },
};

function v1(id: string, agent: string, ts: string, payload: unknown = null): SonderEventV1 {
  return {
    id,
    version: '1',
    agent_id: agent,
    task_id: 't',
    timestamp: ts,
    ...baseCore,
    payload,
  };
}

function v2(
  id: string,
  agent: string,
  ts: string,
  payload: unknown = null,
  parent_id?: string,
): SonderEventV2 {
  return {
    id,
    version: '2',
    agent_id: agent,
    task_id: 't',
    ...(parent_id !== undefined && { parent_id }),
    timestamp: ts,
    ...baseCore,
    payload,
    metadata: { redaction: { fields: [], count: 0, sensitivityLevel: 'high' } },
    chain_prev_hash: `genesis:${agent}:${ts}`,
    chain_self_hash: 'a'.repeat(64),
    signature: 'sig==',
  };
}

describe('AuditLog.queryByAgent', () => {
  let audit: AuditLog;
  beforeEach(() => {
    audit = new AuditLog();
  });
  afterEach(() => {
    audit.close();
  });

  it('returns events in timestamp ASC order', () => {
    audit.write(v2('b', 'agent-x', '2026-05-12T00:00:02Z'));
    audit.write(v2('a', 'agent-x', '2026-05-12T00:00:01Z'));
    audit.write(v2('c', 'agent-x', '2026-05-12T00:00:03Z'));

    const rows = audit.queryByAgent('agent-x');
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('honors the `from` filter (inclusive lower bound)', () => {
    audit.write(v2('a', 'agent-x', '2026-05-12T00:00:01Z'));
    audit.write(v2('b', 'agent-x', '2026-05-12T00:00:02Z'));
    audit.write(v2('c', 'agent-x', '2026-05-12T00:00:03Z'));

    const rows = audit.queryByAgent('agent-x', { from: '2026-05-12T00:00:02Z' });
    expect(rows.map((r) => r.id)).toEqual(['b', 'c']);
  });

  it('honors the `limit` filter', () => {
    audit.write(v2('a', 'agent-x', '2026-05-12T00:00:01Z'));
    audit.write(v2('b', 'agent-x', '2026-05-12T00:00:02Z'));
    audit.write(v2('c', 'agent-x', '2026-05-12T00:00:03Z'));

    const rows = audit.queryByAgent('agent-x', { limit: 2 });
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('filters by agent_id (other agents excluded)', () => {
    audit.write(v2('a', 'agent-x', '2026-05-12T00:00:01Z'));
    audit.write(v2('b', 'agent-y', '2026-05-12T00:00:01Z'));
    audit.write(v2('c', 'agent-x', '2026-05-12T00:00:02Z'));

    const rows = audit.queryByAgent('agent-x');
    expect(rows.map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('returns an empty array for unknown agents', () => {
    audit.write(v2('a', 'agent-x', '2026-05-12T00:00:01Z'));
    expect(audit.queryByAgent('agent-nobody')).toEqual([]);
  });
});

describe('AuditLog cross-version reads', () => {
  let audit: AuditLog;
  beforeEach(() => {
    audit = new AuditLog();
  });
  afterEach(() => {
    audit.close();
  });

  it('returns mixed v1 + v2 rows; version discriminant preserved', () => {
    audit.write(v1('v1-a', 'agent-x', '2026-05-12T00:00:01Z'));
    audit.write(v2('v2-a', 'agent-x', '2026-05-12T00:00:02Z'));

    const rows = audit.queryByAgent('agent-x');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.version).toBe('1');
    expect(rows[1]?.version).toBe('2');
  });

  it('v1 rows surface without chain or signature fields', () => {
    audit.write(v1('legacy', 'agent-x', '2026-05-12T00:00:01Z'));
    const [row] = audit.queryByAgent('agent-x');
    expect(row?.version).toBe('1');
    expect(row).not.toHaveProperty('chain_self_hash');
    expect(row).not.toHaveProperty('signature');
    expect(row).not.toHaveProperty('chain_prev_hash');
  });

  it('listV2Agents enumerates only agents with at least one v2 row', () => {
    audit.write(v1('v1-a', 'legacy-only', '2026-05-12T00:00:01Z'));
    audit.write(v2('v2-a', 'agent-a', '2026-05-12T00:00:02Z'));
    audit.write(v2('v2-b', 'agent-b', '2026-05-12T00:00:03Z'));
    audit.write(v1('v1-b', 'agent-a', '2026-05-12T00:00:04Z'));

    expect(audit.listV2Agents()).toEqual(['agent-a', 'agent-b']);
  });

  it('readHeadEvent returns the latest v2 row for an agent (ignores v1)', () => {
    audit.write(v2('first', 'agent-x', '2026-05-12T00:00:01Z'));
    audit.write(v2('second', 'agent-x', '2026-05-12T00:00:02Z'));
    audit.write(v1('legacy-newer', 'agent-x', '2026-05-12T00:00:03Z'));

    const head = audit.readHeadEvent('agent-x');
    expect(head?.id).toBe('second');
    expect(head?.version).toBe('2');
  });

  it('readHeadEvent returns null for agents with no v2 events', () => {
    audit.write(v1('legacy', 'legacy-only', '2026-05-12T00:00:01Z'));
    expect(audit.readHeadEvent('legacy-only')).toBeNull();
  });

  it('readLatestHash ignores v1 rows', () => {
    audit.write(v1('legacy', 'agent-x', '2026-05-12T00:00:01Z'));
    expect(audit.readLatestHash('agent-x')).toBeNull();

    audit.write(v2('first', 'agent-x', '2026-05-12T00:00:02Z'));
    expect(audit.readLatestHash('agent-x')).toBe('a'.repeat(64));
  });
});

describe('AuditLog parent_id causal traversal (Phase 3.5)', () => {
  let audit: AuditLog;
  beforeEach(() => {
    audit = new AuditLog();
  });
  afterEach(() => {
    audit.close();
  });

  it('round-trips parent_id through write/read', () => {
    audit.write(v2('root', 'a', '2026-05-12T00:00:01Z'));
    audit.write(v2('child', 'a', '2026-05-12T00:00:02Z', null, 'root'));
    const [, child] = audit.queryByAgent('a');
    expect(child?.parent_id).toBe('root');
  });

  it('filters by parent_id via EventFilter', () => {
    audit.write(v2('root', 'a', '2026-05-12T00:00:01Z'));
    audit.write(v2('c1', 'a', '2026-05-12T00:00:02Z', null, 'root'));
    audit.write(v2('c2', 'a', '2026-05-12T00:00:03Z', null, 'root'));
    audit.write(v2('other', 'a', '2026-05-12T00:00:04Z', null, 'somewhere-else'));

    const rows = audit.query({ parent_id: 'root' });
    expect(rows.map((r) => r.id)).toEqual(['c1', 'c2']);
  });

  it('queryChildren returns only direct children', () => {
    audit.write(v2('root', 'a', '2026-05-12T00:00:01Z'));
    audit.write(v2('c1', 'a', '2026-05-12T00:00:02Z', null, 'root'));
    audit.write(v2('gc1', 'a', '2026-05-12T00:00:03Z', null, 'c1'));

    expect(audit.queryChildren('root').map((r) => r.id)).toEqual(['c1']);
  });

  it('queryDescendants walks the whole causal DAG (BFS, root excluded)', () => {
    //   root
    //   ├─ c1
    //   │   └─ gc1
    //   └─ c2
    audit.write(v2('root', 'a', '2026-05-12T00:00:01Z'));
    audit.write(v2('c1', 'a', '2026-05-12T00:00:02Z', null, 'root'));
    audit.write(v2('c2', 'a', '2026-05-12T00:00:03Z', null, 'root'));
    audit.write(v2('gc1', 'a', '2026-05-12T00:00:04Z', null, 'c1'));

    const ids = audit.queryDescendants('root').map((r) => r.id);
    expect(ids).toContain('c1');
    expect(ids).toContain('c2');
    expect(ids).toContain('gc1');
    expect(ids).not.toContain('root');
    expect(ids).toHaveLength(3);
  });

  it('queryDescendants honors maxDepth', () => {
    audit.write(v2('root', 'a', '2026-05-12T00:00:01Z'));
    audit.write(v2('c1', 'a', '2026-05-12T00:00:02Z', null, 'root'));
    audit.write(v2('gc1', 'a', '2026-05-12T00:00:03Z', null, 'c1'));

    const ids = audit.queryDescendants('root', { maxDepth: 1 }).map((r) => r.id);
    expect(ids).toEqual(['c1']);
  });

  it('queryDescendants is cycle-safe', () => {
    // Pathological: a <-> b cycle. Should terminate, visiting each once.
    audit.write(v2('a', 'ag', '2026-05-12T00:00:01Z', null, 'b'));
    audit.write(v2('b', 'ag', '2026-05-12T00:00:02Z', null, 'a'));

    const ids = audit.queryDescendants('a').map((r) => r.id);
    expect(ids).toEqual(['b']);
  });
});
