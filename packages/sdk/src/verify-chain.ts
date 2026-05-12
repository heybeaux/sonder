/**
 * Verify-chain (Spec 2 Task 9 / R7).
 *
 * Programmatic API: `verifyChain({ audit, agentId, publicKey })`.
 * Walks v2 events for an agent in timestamp ASC order. For each event:
 *
 *   1. Recompute chain_self_hash; compare with stored value.
 *   2. Verify the ed25519 signature.
 *   3. Assert chain_prev_hash === predecessor.chain_self_hash (or equals
 *      the genesis seed for the first event).
 *
 * v1 rows mid-walk emit a `v1-skipped` warning entry and do not break
 * the chain (R11).
 *
 * Returns a structured result. Exit-code mapping (R7) is handled by the
 * CLI wrapper:
 *
 *   - status: 'pass'    -> exit 0
 *   - status: 'mismatch' -> exit 1
 *   - status: 'missing'  -> exit 2
 */

import { createPublicKey, type KeyObject } from 'node:crypto';
import {
  AuditLog,
  chainSelfHash,
  verify,
  genesisSeed,
  type SonderEventAny,
  type SonderEventV2,
} from '@heybeaux/sonder-core';

export interface VerifyChainOptions {
  audit: AuditLog;
  agentId: string;
  publicKey: KeyObject;
}

export type VerifyCheck =
  | 'chain_self_hash'
  | 'signature'
  | 'chain_prev_hash'
  | 'genesis_seed';

export interface VerifyMismatch {
  eventId: string;
  index: number;
  check: VerifyCheck;
  expected: string;
  actual: string;
  message: string;
}

export interface VerifyWarning {
  eventId: string;
  index: number;
  kind: 'v1-skipped';
  message: string;
}

export type VerifyChainResult =
  | {
      status: 'pass';
      agentId: string;
      eventsChecked: number;
      headEventId: string;
      headChainHash: string;
      warnings: VerifyWarning[];
    }
  | {
      status: 'mismatch';
      agentId: string;
      eventsChecked: number;
      mismatch: VerifyMismatch;
      warnings: VerifyWarning[];
    }
  | {
      status: 'missing';
      agentId: string;
      reason: string;
    };

export function verifyChain(opts: VerifyChainOptions): VerifyChainResult {
  const { audit, agentId, publicKey } = opts;

  const rows: SonderEventAny[] = audit.queryByAgent(agentId);

  if (rows.length === 0) {
    return {
      status: 'missing',
      agentId,
      reason: `no events found for agent_id="${agentId}"`,
    };
  }

  const v2Events = rows.filter((r): r is SonderEventV2 => r.version === '2');
  const warnings: VerifyWarning[] = [];

  rows.forEach((row, index) => {
    if (row.version === '1') {
      warnings.push({
        eventId: row.id,
        index,
        kind: 'v1-skipped',
        message: `v1 event ${row.id} skipped (not part of the chain)`,
      });
    }
  });

  if (v2Events.length === 0) {
    return {
      status: 'missing',
      agentId,
      reason: `no v2 events for agent_id="${agentId}" (only v1 rows on file)`,
    };
  }

  let prevHash: string | null = null;
  let lastEvent: SonderEventV2 | null = null;

  for (let i = 0; i < v2Events.length; i++) {
    const e = v2Events[i]!;

    // (1) Recompute chain_self_hash.
    const recomputed = chainSelfHash(e as unknown as Record<string, unknown>);
    if (recomputed !== e.chain_self_hash) {
      return {
        status: 'mismatch',
        agentId,
        eventsChecked: i,
        mismatch: {
          eventId: e.id,
          index: i,
          check: 'chain_self_hash',
          expected: e.chain_self_hash,
          actual: recomputed,
          message: `chain_self_hash mismatch on event ${e.id}: stored=${e.chain_self_hash} recomputed=${recomputed}`,
        },
        warnings,
      };
    }

    // (2) Verify signature.
    const sigOk = verify(e as unknown as Record<string, unknown>, publicKey);
    if (!sigOk) {
      return {
        status: 'mismatch',
        agentId,
        eventsChecked: i,
        mismatch: {
          eventId: e.id,
          index: i,
          check: 'signature',
          expected: 'valid ed25519 signature',
          actual: 'verification failed',
          message: `signature verification failed on event ${e.id}`,
        },
        warnings,
      };
    }

    // (3) Chain link.
    if (i === 0) {
      const expectedSeed = genesisSeed(e.agent_id, e.timestamp);
      if (e.chain_prev_hash !== expectedSeed) {
        return {
          status: 'mismatch',
          agentId,
          eventsChecked: i,
          mismatch: {
            eventId: e.id,
            index: i,
            check: 'genesis_seed',
            expected: expectedSeed,
            actual: e.chain_prev_hash,
            message: `genesis seed mismatch on first event ${e.id}: expected ${expectedSeed} got ${e.chain_prev_hash}`,
          },
          warnings,
        };
      }
    } else {
      if (e.chain_prev_hash !== prevHash) {
        return {
          status: 'mismatch',
          agentId,
          eventsChecked: i,
          mismatch: {
            eventId: e.id,
            index: i,
            check: 'chain_prev_hash',
            expected: prevHash ?? '<none>',
            actual: e.chain_prev_hash,
            message: `chain_prev_hash mismatch on event ${e.id}: expected ${prevHash ?? '<none>'} got ${e.chain_prev_hash}`,
          },
          warnings,
        };
      }
    }

    prevHash = e.chain_self_hash;
    lastEvent = e;
  }

  return {
    status: 'pass',
    agentId,
    eventsChecked: v2Events.length,
    headEventId: lastEvent!.id,
    headChainHash: lastEvent!.chain_self_hash,
    warnings,
  };
}

/**
 * Helper: convert a base64-encoded raw public key (as exposed via
 * `runtime.publicKey`) into a Node KeyObject suitable for `verifyChain`.
 */
export function loadPublicKeyFromBase64(b64: string): KeyObject {
  const raw = Buffer.from(b64, 'base64');
  if (raw.length !== 32) {
    throw new Error(`ed25519 public key must be 32 bytes, got ${raw.length}`);
  }
  const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
  const der = Buffer.concat([SPKI_PREFIX, raw]);
  return createPublicKey({ key: der, format: 'der', type: 'spki' });
}
