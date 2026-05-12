import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  loadOrGenerateKeypair,
  loadKeypair,
  sign,
  verify,
  SignRefusedError,
  validateL0EvidenceOrThrow,
  publicKeyFromRawBase64,
  privateKeyFromRawBase64,
} from '../sign.js';
import { chainSelfHash } from '../hash.js';

describe('loadOrGenerateKeypair', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sonder-keypair-'));
    path = join(dir, 'key');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('generates a fresh keypair when file is absent', () => {
    const kp = loadOrGenerateKeypair(path);
    expect(kp.generated).toBe(true);
    expect(kp.publicKeyBase64).toMatch(/^[A-Za-z0-9+/=]+$/);
    // 32-byte raw key in base64 -> 44 chars (with padding).
    expect(Buffer.from(kp.publicKeyBase64, 'base64').length).toBe(32);
    expect(existsSync(path)).toBe(true);
  });

  it('persists the keypair with mode 0600', () => {
    loadOrGenerateKeypair(path);
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('reloads the same keypair on a second call', () => {
    const first = loadOrGenerateKeypair(path);
    const second = loadOrGenerateKeypair(path);
    expect(second.generated).toBe(false);
    expect(second.publicKeyBase64).toBe(first.publicKeyBase64);
    expect(second.createdAt).toBe(first.createdAt);
  });

  it('refuses to load a key file with mode 0644', () => {
    const kp = loadOrGenerateKeypair(path);
    expect(kp.generated).toBe(true);
    chmodSync(path, 0o644);
    expect(() => loadKeypair(path)).toThrow(/refusing to load key with mode 0644/);
  });

  it('refuses to load a key file with mode 0640', () => {
    loadOrGenerateKeypair(path);
    chmodSync(path, 0o640);
    expect(() => loadKeypair(path)).toThrow(/refusing to load key with mode/);
  });

  it('refuses to load a malformed file', () => {
    writeFileSync(path, '{}', { mode: 0o600 });
    expect(() => loadKeypair(path)).toThrow(/missing privateKey or publicKey/);
  });

  it('creates the parent directory when missing', () => {
    const nested = join(dir, 'nested', 'subdir', 'key');
    const kp = loadOrGenerateKeypair(nested);
    expect(kp.generated).toBe(true);
    expect(existsSync(nested)).toBe(true);
  });
});

describe('sign / verify', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sonder-sign-'));
    path = join(dir, 'key');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('signs and verifies an event round-trip', () => {
    const kp = loadOrGenerateKeypair(path);
    const event = {
      version: '2',
      id: 'evt-1',
      agent_id: 'a',
      task_id: 't',
      timestamp: '2026-05-12T00:00:00Z',
      chain_prev_hash: 'genesis:a:2026-05-12T00:00:00Z',
      chain_self_hash: chainSelfHash({
        version: '2',
        id: 'evt-1',
        agent_id: 'a',
        task_id: 't',
        timestamp: '2026-05-12T00:00:00Z',
        chain_prev_hash: 'genesis:a:2026-05-12T00:00:00Z',
        payload: 'hello',
      }),
      payload: 'hello',
    };
    const sig = sign(event, kp.privateKey);
    const signedEvent = { ...event, signature: sig };
    expect(verify(signedEvent, kp.publicKey)).toBe(true);
  });

  it('signature is deterministic for the same input (ed25519)', () => {
    const kp = loadOrGenerateKeypair(path);
    const event = { version: '2' as const, id: 'evt-1', payload: 'hello' };
    const sig1 = sign(event, kp.privateKey);
    const sig2 = sign(event, kp.privateKey);
    expect(sig1).toBe(sig2);
  });

  it('verify returns false on tampered payload', () => {
    const kp = loadOrGenerateKeypair(path);
    const event = { version: '2' as const, id: 'evt-1', payload: 'hello' };
    const sig = sign(event, kp.privateKey);
    const tampered = { ...event, payload: 'goodbye', signature: sig };
    expect(verify(tampered, kp.publicKey)).toBe(false);
  });

  it('verify returns false on missing signature field', () => {
    const kp = loadOrGenerateKeypair(path);
    const event = { version: '2' as const, id: 'evt-1', payload: 'hello' };
    expect(verify(event, kp.publicKey)).toBe(false);
  });

  it('verify returns false on garbage signature', () => {
    const kp = loadOrGenerateKeypair(path);
    const event = {
      version: '2' as const,
      id: 'evt-1',
      payload: 'hello',
      signature: 'not-base64-or-too-short',
    };
    expect(verify(event, kp.publicKey)).toBe(false);
  });

  it('verify works with a public key reloaded from base64', () => {
    const kp = loadOrGenerateKeypair(path);
    const event = { version: '2' as const, id: 'evt-1', payload: 'hello' };
    const sig = sign(event, kp.privateKey);
    const reloadedPubKey = publicKeyFromRawBase64(kp.publicKeyBase64);
    expect(verify({ ...event, signature: sig }, reloadedPubKey)).toBe(true);
  });

  it('private + public key derived from raw base64 produce valid signatures', () => {
    const kp = loadOrGenerateKeypair(path);
    const event = { version: '2' as const, id: 'evt-1', payload: 'hello' };
    const seed = JSON.parse(readFileSync(path, 'utf8')).privateKey as string;
    const reloadedPriv = privateKeyFromRawBase64(seed);
    const sig = sign(event, reloadedPriv);
    expect(verify({ ...event, signature: sig }, kp.publicKey)).toBe(true);
  });
});

describe('validateL0EvidenceOrThrow (Spec 2 R12)', () => {
  it('allows events with no governance', () => {
    expect(() => validateL0EvidenceOrThrow({ id: 'x' })).not.toThrow();
  });

  it('allows events with no governance.tier', () => {
    expect(() => validateL0EvidenceOrThrow({ governance: { contract_id: 'c' } })).not.toThrow();
  });

  it('allows L0-only tier with no evidence', () => {
    expect(() =>
      validateL0EvidenceOrThrow({ governance: { tier: 'L0' } }),
    ).not.toThrow();
  });

  it('refuses L1 tier with empty evidence', () => {
    expect(() =>
      validateL0EvidenceOrThrow({ governance: { tier: 'L1', evidence: [] } }),
    ).toThrow(SignRefusedError);
  });

  it('refuses L1 tier with no evidence field', () => {
    expect(() =>
      validateL0EvidenceOrThrow({ governance: { tier: 'L1' } }),
    ).toThrow(/l0-evidence-missing/);
  });

  it('refuses L0+L2 tier with no evidence', () => {
    expect(() =>
      validateL0EvidenceOrThrow({ governance: { tier: 'L0+L2' } }),
    ).toThrow(SignRefusedError);
  });

  it('allows L0+L1 tier when evidence is present', () => {
    expect(() =>
      validateL0EvidenceOrThrow({
        governance: {
          tier: 'L0+L1',
          evidence: [{ rule_id: 'r1', rule_kind: 'regex-deny', outcome: 'pass' }],
        },
      }),
    ).not.toThrow();
  });

  it('refuses L3 tier with non-array evidence', () => {
    expect(() =>
      validateL0EvidenceOrThrow({ governance: { tier: 'L3', evidence: 'wat' } }),
    ).toThrow(SignRefusedError);
  });

  it('SignRefusedError carries the code', () => {
    try {
      validateL0EvidenceOrThrow({ governance: { tier: 'L1' } });
      expect.fail('did not throw');
    } catch (err) {
      expect(err).toBeInstanceOf(SignRefusedError);
      expect((err as SignRefusedError).code).toBe('l0-evidence-missing');
      expect((err as SignRefusedError).name).toBe('SignRefusedError');
    }
  });
});
