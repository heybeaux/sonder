/**
 * Chain helpers — genesis seeds, chain-hash stamping, and the
 * IMMEDIATE-tx chain writer.
 *
 * Used by the v2 emit pipeline (Task 7) and the verifier CLI (Task 9).
 *
 * Spec references:
 *   - R4 (genesis seed format)
 *   - R5 (chain integrity invariant)
 *   - R6 (concurrency / IMMEDIATE TX)
 */

import type { AuditLog } from './audit.js';
import type { SonderEventV2 } from './types/event.js';
import { chainSelfHash } from './hash.js';

/**
 * Build the genesis seed string for an agent's first event. Format:
 * `genesis:<agent_id>:<iso8601>` per Spec 2 R4. The `iso8601` is the
 * timestamp of the first event for the agent.
 */
export function genesisSeed(agent_id: string, iso8601: string): string {
  return `genesis:${agent_id}:${iso8601}`;
}

/**
 * Return the `chain_prev_hash` value for the next event to write. If the
 * agent has no prior v2 events, returns the genesis seed using the
 * supplied `iso8601` (which becomes the genesis timestamp). Otherwise
 * returns the latest event's `chain_self_hash`.
 *
 * Callers MUST invoke this inside `audit.immediate(...)` so the read +
 * write are serialized per agent and the chain stays unforked under
 * concurrent emits.
 */
export function readPrevHashForNextEvent(
  audit: AuditLog,
  agent_id: string,
  iso8601: string,
): string {
  const latest = audit.readLatestHash(agent_id);
  if (latest !== null) return latest;
  // First event for this agent — derive (and persist if not already) the
  // genesis seed. The `chain_genesis` row is written by `audit.writeChain`
  // itself when the agent has no row yet, so we just produce the seed here.
  const existingGenesis = audit.readGenesis(agent_id);
  if (existingGenesis) {
    return genesisSeed(agent_id, existingGenesis.genesis_timestamp);
  }
  return genesisSeed(agent_id, iso8601);
}

/**
 * Stamp a pre-chain event with `chain_prev_hash` and `chain_self_hash`.
 *
 * Input MUST be the redacted event with all v1 cognitive-context fields
 * + `metadata.redaction` set. The function returns a copy with the two
 * chain fields populated; the signature is added separately by the
 * sign step.
 *
 * NOTE: this is a pure function — no DB I/O. The caller (the emit
 * pipeline) is responsible for invoking `readPrevHashForNextEvent`
 * inside an IMMEDIATE TX and passing the result here.
 */
export function stampChainHashes(
  event: Omit<SonderEventV2, 'chain_self_hash' | 'signature'>,
): Omit<SonderEventV2, 'signature'> {
  // Compute chain_self_hash over the canonicalized event with chain_self_hash
  // and signature stripped. The input here lacks both, so we can pass it
  // through directly — chainSelfHash internally strips again as a defensive
  // measure (it's idempotent).
  const self = chainSelfHash(event as unknown as Record<string, unknown>);
  return { ...event, chain_self_hash: self };
}
