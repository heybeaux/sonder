/**
 * Anchor manifest tests (Spec 2 Task 10 / R8 / R9).
 *
 * Pure manifest determinism, agent ordering, multi-agent aggregation,
 * exclusion of agents with no v2 events.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { createRuntime } from '../runtime.js';
import { buildAnchorManifest, serializeAnchorManifest } from '../anchor.js';

describe('buildAnchorManifest', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sonder-anchor-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const mk = () => createRuntime({ keyPath: join(dir, 'key'), dbPath: join(dir, 'audit.db') });

  it('one agent, one event: emits a single entry with head_event = head_chain', async () => {
    const runtime = mk();
    const e = await runtime.emit({ agent_id: 'agent-a', task_id: 't', payload: { n: 1 } });

    const m = buildAnchorManifest({
      audit: runtime.bus.audit,
      publicKey: runtime.publicKey,
      generatedAt: '2026-05-12T00:00:00.000Z',
    });

    expect(m.version).toBe('1');
    expect(m.generated_at).toBe('2026-05-12T00:00:00.000Z');
    expect(m.entries).toHaveLength(1);
    expect(m.entries[0]?.agent_id).toBe('agent-a');
    expect(m.entries[0]?.chain_head).toBe(e.chain_self_hash);
    expect(m.entries[0]?.head_event_id).toBe(e.id);
    expect(m.entries[0]?.public_key).toBe(runtime.publicKey);
    runtime.shutdown();
  });

  it('multi-agent: entries sorted lexicographically by agent_id', async () => {
    const runtime = mk();
    await runtime.emit({ agent_id: 'zeta', task_id: 't', payload: null });
    await runtime.emit({ agent_id: 'alpha', task_id: 't', payload: null });
    await runtime.emit({ agent_id: 'mu', task_id: 't', payload: null });

    const m = buildAnchorManifest({
      audit: runtime.bus.audit,
      publicKey: runtime.publicKey,
      generatedAt: '2026-05-12T00:00:00.000Z',
    });
    expect(m.entries.map((e) => e.agent_id)).toEqual(['alpha', 'mu', 'zeta']);
    runtime.shutdown();
  });

  it('head_event tracks the latest emit per agent', async () => {
    const runtime = mk();
    await runtime.emit({ agent_id: 'a', task_id: 't', payload: { n: 0 } });
    await runtime.emit({ agent_id: 'a', task_id: 't', payload: { n: 1 } });
    const last = await runtime.emit({ agent_id: 'a', task_id: 't', payload: { n: 2 } });

    const m = buildAnchorManifest({
      audit: runtime.bus.audit,
      publicKey: runtime.publicKey,
      generatedAt: '2026-05-12T00:00:00.000Z',
    });
    expect(m.entries[0]?.head_event_id).toBe(last.id);
    expect(m.entries[0]?.chain_head).toBe(last.chain_self_hash);
    runtime.shutdown();
  });

  it('agentIds option restricts to a subset', async () => {
    const runtime = mk();
    await runtime.emit({ agent_id: 'a', task_id: 't', payload: null });
    await runtime.emit({ agent_id: 'b', task_id: 't', payload: null });
    await runtime.emit({ agent_id: 'c', task_id: 't', payload: null });

    const m = buildAnchorManifest({
      audit: runtime.bus.audit,
      publicKey: runtime.publicKey,
      generatedAt: '2026-05-12T00:00:00.000Z',
      agentIds: ['b', 'c'],
    });
    expect(m.entries.map((e) => e.agent_id)).toEqual(['b', 'c']);
    runtime.shutdown();
  });
});

describe('serializeAnchorManifest determinism', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sonder-anchor-det-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const mk = () => createRuntime({ keyPath: join(dir, 'key'), dbPath: join(dir, 'audit.db') });

  it('byte-for-byte stable across repeated serialization', async () => {
    const runtime = mk();
    for (let i = 0; i < 5; i++) {
      await runtime.emit({ agent_id: 'agent-x', task_id: 't', payload: { n: i } });
    }
    const gen = '2026-05-12T00:00:00.000Z';

    const m1 = buildAnchorManifest({ audit: runtime.bus.audit, publicKey: runtime.publicKey, generatedAt: gen });
    const m2 = buildAnchorManifest({ audit: runtime.bus.audit, publicKey: runtime.publicKey, generatedAt: gen });

    const s1 = serializeAnchorManifest(m1);
    const s2 = serializeAnchorManifest(m2);
    expect(s1).toBe(s2);
    expect(Buffer.byteLength(s1, 'utf8')).toBe(Buffer.byteLength(s2, 'utf8'));
    runtime.shutdown();
  });

  it('canonical JSON: keys sorted, no whitespace, ends with newline', async () => {
    const runtime = mk();
    await runtime.emit({ agent_id: 'agent-a', task_id: 't', payload: null });

    const m = buildAnchorManifest({
      audit: runtime.bus.audit,
      publicKey: runtime.publicKey,
      generatedAt: '2026-05-12T00:00:00.000Z',
    });
    const s = serializeAnchorManifest(m);

    expect(s.endsWith('\n')).toBe(true);
    // No newlines or extra whitespace inside the body.
    expect(s.slice(0, -1)).not.toMatch(/\s\s/);
    // Sorted keys: top-level should start with `{"entries":...`.
    expect(s).toMatch(/^\{"entries":/);
    runtime.shutdown();
  });
});

describe('sonder-anchor CLI (dry-run + git flow)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sonder-anchor-cli-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('dry-run writes a deterministic manifest file', async () => {
    const runtime = createRuntime({ keyPath: join(dir, 'key'), dbPath: join(dir, 'audit.db') });
    await runtime.emit({ agent_id: 'a', task_id: 't', payload: { n: 1 } });
    runtime.shutdown();

    const outRel = join(dir, 'manifests-dryrun');
    // Use the run() programmatic export so we don't need to spawn node.
    const { run } = await import('../cli/anchor.js');
    const { exitCode, result } = run([
      '--db', join(dir, 'audit.db'),
      '--pub-key', runtime.publicKey,
      '--manifest-path', outRel,
      '--date', '2026-05-12',
      '--dry-run',
    ]);
    expect(exitCode).toBe(0);
    expect(result.status).toBe('success');
    expect(result.agents).toBe(1);
    expect(existsSync(join(outRel, '2026-05-12.json'))).toBe(true);
    const body = readFileSync(join(outRel, '2026-05-12.json'), 'utf8');
    expect(body).toMatch(/^\{"entries":/);
    expect(body.endsWith('\n')).toBe(true);
  });

  it('returns "missing" with exit 2 when no v2 agents exist', async () => {
    // Fresh DB, no emits.
    const { AuditLog } = await import('@heybeaux/sonder-core');
    const a = new AuditLog(join(dir, 'audit.db'));
    a.close();

    const { run } = await import('../cli/anchor.js');
    const { exitCode, result } = run([
      '--db', join(dir, 'audit.db'),
      '--pub-key', 'AAAA' + 'A'.repeat(40), // arbitrary; not used since we exit early
      '--dry-run',
      '--manifest-path', join(dir, 'empty'),
      '--date', '2026-05-12',
    ]);
    expect(exitCode).toBe(2);
    expect(result.status).toBe('missing');
  });

  it('full git flow: writes manifest + commits + tags (no remote push)', async () => {
    const runtime = createRuntime({ keyPath: join(dir, 'key'), dbPath: join(dir, 'audit.db') });
    await runtime.emit({ agent_id: 'a', task_id: 't', payload: { n: 1 } });
    runtime.shutdown();

    const repo = join(dir, 'anchor-repo');
    // Init a bare-bones git repo with a single commit.
    spawnSync('git', ['init', '-q', repo]);
    spawnSync('git', ['-C', repo, 'config', 'user.email', 'test@example.com']);
    spawnSync('git', ['-C', repo, 'config', 'user.name', 'Test']);
    spawnSync('git', ['-C', repo, 'commit', '--allow-empty', '-q', '-m', 'init']);
    // Set up a local "remote" so push doesn't error — point at a bare clone.
    const bare = join(dir, 'anchor-remote.git');
    spawnSync('git', ['init', '-q', '--bare', bare]);
    spawnSync('git', ['-C', repo, 'remote', 'add', 'origin', bare]);

    const { run } = await import('../cli/anchor.js');
    const { exitCode, result } = run([
      '--db', join(dir, 'audit.db'),
      '--pub-key', runtime.publicKey,
      '--repo', repo,
      '--manifest-path', 'anchors',
      '--remote', 'origin',
      '--date', '2026-05-12',
    ]);
    expect(exitCode).toBe(0);
    expect(result.status).toBe('success');
    expect(result.tag).toBe('anchor-2026-05-12');
    expect(existsSync(join(repo, 'anchors', '2026-05-12.json'))).toBe(true);

    // Idempotent rerun.
    const second = run([
      '--db', join(dir, 'audit.db'),
      '--pub-key', runtime.publicKey,
      '--repo', repo,
      '--manifest-path', 'anchors',
      '--remote', 'origin',
      '--date', '2026-05-12',
    ]);
    expect(second.exitCode).toBe(0);
  });
});
