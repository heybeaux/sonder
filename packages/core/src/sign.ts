/**
 * Ed25519 signing primitives for Sonder's audit chain (Spec 2 R3 / R10).
 *
 * - `loadOrGenerateKeypair(path)` — load an existing key file or generate
 *   a fresh keypair and persist it. Enforces mode `0600`.
 * - `sign(event, privateKey)` — produce a base64 ed25519 signature over
 *   the JCS-canonicalized event (with `chain_self_hash` present and
 *   `signature` absent).
 * - `verify(event, publicKey)` — strip `signature`, recompute the JCS
 *   target, verify against the public key.
 *
 * Uses Node's built-in `crypto` module — no userland ed25519 dep.
 */

import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  KeyObject,
} from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { canonicalize, stripSignatureField } from './hash.js';

/**
 * On-disk keypair format. Both keys are base64-encoded raw 32-byte ed25519
 * values to match the format published in anchor manifests.
 */
export interface KeypairFile {
  privateKey: string; // base64 of 32-byte raw seed
  publicKey: string; // base64 of 32-byte raw public key
  createdAt: string; // ISO8601
}

/** Loaded keypair as Node KeyObjects + the original base64 public key. */
export interface LoadedKeypair {
  privateKey: KeyObject;
  publicKey: KeyObject;
  publicKeyBase64: string;
  createdAt: string;
  /** Whether the key was freshly generated on this call (true) or loaded (false). */
  generated: boolean;
}

const KEYPAIR_MODE = 0o600;

/**
 * Load an existing keypair from `path`, or generate a fresh one and
 * persist it. The file is created with mode 0600. Loading refuses with
 * `Error('keypair: refusing to load key with mode <octal>; require 0600')`
 * when the file exists with more-permissive mode.
 *
 * The parent directory is created (mode 0700) when missing.
 */
export function loadOrGenerateKeypair(path: string): LoadedKeypair {
  if (existsSync(path)) {
    return loadKeypair(path);
  }
  return generateAndPersistKeypair(path);
}

/**
 * Load an existing keypair. Throws if the file is missing or has an
 * unsafe mode.
 */
export function loadKeypair(path: string): LoadedKeypair {
  if (!existsSync(path)) {
    throw new Error(`keypair: file not found: ${path}`);
  }
  const st = statSync(path);
  // Mode comes back as the full stat mode; mask to the perms portion.
  const perms = st.mode & 0o777;
  if (perms !== KEYPAIR_MODE) {
    throw new Error(
      `keypair: refusing to load key with mode ${perms.toString(8).padStart(4, '0')}; require 0600`,
    );
  }
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw) as KeypairFile;
  if (!parsed.privateKey || !parsed.publicKey) {
    throw new Error('keypair: file is missing privateKey or publicKey');
  }
  const privateKey = privateKeyFromRawBase64(parsed.privateKey);
  const publicKey = publicKeyFromRawBase64(parsed.publicKey);
  return {
    privateKey,
    publicKey,
    publicKeyBase64: parsed.publicKey,
    createdAt: parsed.createdAt,
    generated: false,
  };
}

/** Generate a fresh keypair, persist it under mode 0600, return both halves. */
export function generateAndPersistKeypair(path: string): LoadedKeypair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');

  // Extract the raw 32-byte values from the DER-encoded outputs for base64
  // persistence. Ed25519 DER public key = ASN.1 SEQ; the last 32 bytes are
  // the raw key. Private key DER (PKCS#8) ends with the seed in the
  // PrivateKey OCTET STRING (length-prefixed within an inner OCTET STRING).
  const pubDer = publicKey.export({ format: 'der', type: 'spki' });
  const pubRaw = pubDer.subarray(pubDer.length - 32);

  const privDer = privateKey.export({ format: 'der', type: 'pkcs8' });
  // PKCS#8 ed25519: the seed is the last 32 bytes of the DER blob.
  const privRaw = privDer.subarray(privDer.length - 32);

  const file: KeypairFile = {
    privateKey: privRaw.toString('base64'),
    publicKey: pubRaw.toString('base64'),
    createdAt: new Date().toISOString(),
  };

  // Ensure parent dir exists with safe perms.
  const dir = dirname(path);
  if (dir && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  writeFileSync(path, JSON.stringify(file, null, 2), { mode: KEYPAIR_MODE });
  // writeFileSync's `mode` is the create mode; on systems where the file
  // already existed (and we somehow got past existsSync), chmod to enforce.
  chmodSync(path, KEYPAIR_MODE);

  return {
    privateKey,
    publicKey,
    publicKeyBase64: file.publicKey,
    createdAt: file.createdAt,
    generated: true,
  };
}

/**
 * Sign an event per Spec 2 R3. The input MUST already have
 * `chain_self_hash` set; `signature` is stripped before canonicalization.
 *
 * Returns the base64 ed25519 signature.
 */
export function sign(event: Record<string, unknown>, privateKey: KeyObject): string {
  const stripped = stripSignatureField(event);
  const canonical = canonicalize(stripped);
  const sigBuf = cryptoSign(null, Buffer.from(canonical, 'utf8'), privateKey);
  return sigBuf.toString('base64');
}

/**
 * Verify an event's signature per Spec 2 R3. Strips `signature`, recomputes
 * the canonical bytes, and verifies against the public key. Returns
 * `true` on valid, `false` otherwise. Never throws on signature mismatch
 * (verifier callers want a boolean so they can attribute the mismatch).
 */
export function verify(event: Record<string, unknown>, publicKey: KeyObject): boolean {
  const sig = event['signature'];
  if (typeof sig !== 'string') return false;
  let sigBuf: Buffer;
  try {
    sigBuf = Buffer.from(sig, 'base64');
  } catch {
    return false;
  }
  const stripped = stripSignatureField(event);
  const canonical = canonicalize(stripped);
  try {
    return cryptoVerify(null, Buffer.from(canonical, 'utf8'), publicKey, sigBuf);
  } catch {
    return false;
  }
}

/**
 * Build a Node ed25519 public KeyObject from the raw 32-byte base64 form.
 * Ed25519 SPKI DER prefix: 30 2a 30 05 06 03 2b 65 70 03 21 00.
 */
export function publicKeyFromRawBase64(b64: string): KeyObject {
  const raw = Buffer.from(b64, 'base64');
  if (raw.length !== 32) {
    throw new Error(`ed25519 public key must be 32 bytes (got ${raw.length})`);
  }
  const prefix = Buffer.from('302a300506032b6570032100', 'hex');
  const spki = Buffer.concat([prefix, raw]);
  return createPublicKey({ key: spki, format: 'der', type: 'spki' });
}

/**
 * Build a Node ed25519 private KeyObject from the raw 32-byte seed in
 * base64. Ed25519 PKCS#8 DER prefix:
 *   30 2e 02 01 00 30 05 06 03 2b 65 70 04 22 04 20.
 */
export function privateKeyFromRawBase64(b64: string): KeyObject {
  const raw = Buffer.from(b64, 'base64');
  if (raw.length !== 32) {
    throw new Error(`ed25519 private seed must be 32 bytes (got ${raw.length})`);
  }
  const prefix = Buffer.from('302e020100300506032b657004220420', 'hex');
  const pkcs8 = Buffer.concat([prefix, raw]);
  return createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
}

/**
 * Custom error class for sign-refusal per Spec 2 R12 (L0 evidence required
 * when governance.tier references L1/L2/L3). Thrown by `runtime.emit`
 * BEFORE hash/sign so the event is dropped, not persisted.
 */
export class SignRefusedError extends Error {
  override readonly name = 'SignRefusedError';
  readonly code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

/**
 * Validate Spec 2 R12 — refuse to sign when governance.tier references
 * L1/L2/L3 but governance.evidence is empty/absent. Throws
 * `SignRefusedError('l0-evidence-missing')` on refusal. Returns silently
 * when the event is allowed.
 */
export function validateL0EvidenceOrThrow(event: Record<string, unknown>): void {
  const governance = event['governance'] as Record<string, unknown> | undefined;
  if (!governance) return;
  const tier = governance['tier'];
  if (typeof tier !== 'string' || tier.length === 0) return;
  const tiers = tier.split('+').map((t) => t.trim());
  const claimsHigherTier = tiers.some((t) => t === 'L1' || t === 'L2' || t === 'L3');
  if (!claimsHigherTier) return;
  const evidence = governance['evidence'];
  if (!Array.isArray(evidence) || evidence.length === 0) {
    throw new SignRefusedError('l0-evidence-missing');
  }
}
