/**
 * Anchor manifest builder (Spec 2 Task 10 / R8).
 *
 * Pure: no I/O. Given an AuditLog + a generation timestamp + the public
 * key, produces a byte-deterministic JSON string.
 *
 * Manifest shape (R8):
 *
 * {
 *   version: '1',
 *   generated_at: iso8601,
 *   entries: [
 *     {
 *       agent_id, chain_head, head_event_id, head_timestamp,
 *       anchored_at, public_key,
 *     }
 *   ]
 * }
 *
 * Entries are sorted by `agent_id` ASC for determinism.
 */

import { AuditLog, canonicalize } from '@heybeaux/sonder-core';

export interface AnchorEntry {
  agent_id: string;
  chain_head: string;
  head_event_id: string;
  head_timestamp: string;
  anchored_at: string;
  public_key: string;
}

export interface AnchorManifest {
  version: '1';
  generated_at: string;
  entries: AnchorEntry[];
}

export interface BuildAnchorManifestOptions {
  audit: AuditLog;
  publicKey: string;
  /** ISO8601 timestamp used for both `generated_at` and each entry's `anchored_at`. */
  generatedAt: string;
  /** Optionally restrict to a subset of agents (defaults to all v2 agents). */
  agentIds?: string[];
}

/**
 * Build the manifest object. Pure; no DB writes.
 */
export function buildAnchorManifest(opts: BuildAnchorManifestOptions): AnchorManifest {
  const { audit, publicKey, generatedAt } = opts;
  const agents = (opts.agentIds ?? audit.listV2Agents()).slice().sort();

  const entries: AnchorEntry[] = [];
  for (const agent_id of agents) {
    const head = audit.readHeadEvent(agent_id);
    if (!head) continue; // Agent has no v2 events — skip.
    entries.push({
      agent_id,
      chain_head: head.chain_self_hash,
      head_event_id: head.id,
      head_timestamp: head.timestamp,
      anchored_at: generatedAt,
      public_key: publicKey,
    });
  }

  return {
    version: '1',
    generated_at: generatedAt,
    entries,
  };
}

/**
 * Serialize the manifest to a deterministic, byte-stable string. Uses the
 * core RFC 8785 canonicalizer so the output is identical across runs and
 * across machines. A trailing newline is appended for POSIX-friendliness;
 * the body before the newline is the canonicalized JSON.
 */
export function serializeAnchorManifest(manifest: AnchorManifest): string {
  return canonicalize(manifest) + '\n';
}
