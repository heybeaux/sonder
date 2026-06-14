/**
 * GateRegistry — in-process store of gate lifecycle state.
 *
 * Spike A.5 gives Sonder the mechanism (`checkGate` veto + `GatePendingError`)
 * but leaves the question of *where the resolution lives* to the policy
 * adapter. For v1 (single-process, ~1-2 agents, cockpit co-located) we
 * settle that: the GateRegistry holds gate records by `gate_id`, the
 * cockpit calls `resolve()` directly, and policy adapters (Lattice/AWM)
 * query `getStatus()` from their `getGateStatus` callback.
 *
 * GateRegistry is **deliberately not a singleton**. Construct one per
 * SonderBus, pass by reference. v1.5 multi-process swaps this for a
 * store-backed adapter (Redis/SQLite) without touching call sites.
 *
 * The registry is a projection of an event log — every register/resolve
 * is appended as a JSONL line that can be replayed on startup. This keeps
 * v1 crash recovery trivial: lose the process, replay the log, you're
 * back where you were.
 */

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { ApprovalGate } from './types/event.js';

export type GateDecision = 'resume' | 'deny';

export interface GateRecord {
  gate_id: string;
  /** Adapter that opened the gate. */
  adapter_name: string;
  /** Gate envelope as opened by the policy adapter. */
  gate: ApprovalGate;
  status: 'pending' | 'resolved' | 'denied' | 'expired';
  decision?: GateDecision;
  /** Operator-supplied edited args, when `decision === 'resume'`. */
  edited_args?: Record<string, unknown>;
  /** Reason supplied with a deny decision. */
  deny_reason?: string;
  createdAt: string;
  resolvedAt?: string;
}

/** Audit log entry — JSONL line. */
type GateLogEntry =
  | { type: 'register'; record: GateRecord }
  | {
      type: 'resolve';
      gate_id: string;
      decision: GateDecision;
      edited_args?: Record<string, unknown>;
      deny_reason?: string;
      resolvedAt: string;
    }
  | { type: 'expire'; gate_id: string; resolvedAt: string };

export interface GateRegistryOptions {
  /**
   * If set, every mutation is appended as JSONL. On construction, the file
   * is replayed to rebuild registry state. Omit for in-memory-only mode
   * (tests, ephemeral sessions).
   */
  auditPath?: string;
}

export class GateRegistry {
  private readonly records = new Map<string, GateRecord>();
  private readonly auditPath?: string;
  private readonly listeners = new Set<(rec: GateRecord) => void>();

  constructor(options: GateRegistryOptions = {}) {
    if (options.auditPath !== undefined) this.auditPath = options.auditPath;
    if (this.auditPath) {
      mkdirSync(dirname(this.auditPath), { recursive: true });
      if (existsSync(this.auditPath)) this.replay();
    }
  }

  /**
   * Called by the emit pipeline (or a policy adapter) when a pending gate
   * is first surfaced. Idempotent on `gate_id` — a second register with
   * the same id is a no-op so retries don't double-record.
   */
  register(adapterName: string, gate: ApprovalGate): GateRecord {
    const existing = this.records.get(gate.gate_id);
    if (existing) return existing;

    const record: GateRecord = {
      gate_id: gate.gate_id,
      adapter_name: adapterName,
      gate,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    this.records.set(gate.gate_id, record);
    this.appendLog({ type: 'register', record });
    for (const l of this.listeners) safe(() => l(record));
    return record;
  }

  /**
   * Called by the cockpit when the operator resolves the gate.
   * Returns the updated record, or null if the gate is unknown or
   * already resolved.
   */
  resolve(
    gate_id: string,
    decision: GateDecision,
    extras: { edited_args?: Record<string, unknown>; deny_reason?: string } = {},
  ): GateRecord | null {
    const rec = this.records.get(gate_id);
    if (!rec || rec.status !== 'pending') return null;

    rec.status = decision === 'resume' ? 'resolved' : 'denied';
    rec.decision = decision;
    if (extras.edited_args !== undefined) rec.edited_args = extras.edited_args;
    if (extras.deny_reason !== undefined) rec.deny_reason = extras.deny_reason;
    rec.resolvedAt = new Date().toISOString();

    const logEntry: Extract<GateLogEntry, { type: 'resolve' }> = {
      type: 'resolve',
      gate_id,
      decision,
      resolvedAt: rec.resolvedAt,
    };
    if (extras.edited_args !== undefined) logEntry.edited_args = extras.edited_args;
    if (extras.deny_reason !== undefined) logEntry.deny_reason = extras.deny_reason;
    this.appendLog(logEntry);
    for (const l of this.listeners) safe(() => l(rec));
    return rec;
  }

  /**
   * Sweep records past `expires_at`. Caller invokes periodically. Returns
   * the records that flipped to `expired` this call.
   */
  expireOverdue(now: Date = new Date()): GateRecord[] {
    const expired: GateRecord[] = [];
    for (const rec of this.records.values()) {
      if (rec.status !== 'pending') continue;
      if (!rec.gate.expires_at) continue;
      if (Date.parse(rec.gate.expires_at) > now.getTime()) continue;
      rec.status = 'expired';
      rec.resolvedAt = now.toISOString();
      this.appendLog({ type: 'expire', gate_id: rec.gate_id, resolvedAt: rec.resolvedAt });
      for (const l of this.listeners) safe(() => l(rec));
      expired.push(rec);
    }
    return expired;
  }

  /** Read-only lookup used by policy adapters from `getGateStatus`. */
  getStatus(gate_id: string): GateRecord | null {
    return this.records.get(gate_id) ?? null;
  }

  /** Snapshot of all known gates — used by cockpit on first connect. */
  list(): GateRecord[] {
    return Array.from(this.records.values());
  }

  /** Subscribe to register/resolve/expire events. */
  on(listener: (rec: GateRecord) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private appendLog(entry: GateLogEntry): void {
    if (!this.auditPath) return;
    try {
      appendFileSync(this.auditPath, JSON.stringify(entry) + '\n');
    } catch {
      // surface via console only — the registry must not throw on audit
      // write failures, since that would block the gate flow itself.
      // eslint-disable-next-line no-console
      console.warn('[GateRegistry] audit append failed');
    }
  }

  private replay(): void {
    if (!this.auditPath || !existsSync(this.auditPath)) return;
    const raw = readFileSync(this.auditPath, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let entry: GateLogEntry;
      try {
        entry = JSON.parse(line) as GateLogEntry;
      } catch {
        continue;
      }
      if (entry.type === 'register') {
        this.records.set(entry.record.gate_id, { ...entry.record });
      } else if (entry.type === 'resolve') {
        const rec = this.records.get(entry.gate_id);
        if (!rec) continue;
        rec.status = entry.decision === 'resume' ? 'resolved' : 'denied';
        rec.decision = entry.decision;
        if (entry.edited_args !== undefined) rec.edited_args = entry.edited_args;
        if (entry.deny_reason !== undefined) rec.deny_reason = entry.deny_reason;
        rec.resolvedAt = entry.resolvedAt;
      } else if (entry.type === 'expire') {
        const rec = this.records.get(entry.gate_id);
        if (!rec) continue;
        rec.status = 'expired';
        rec.resolvedAt = entry.resolvedAt;
      }
    }
  }
}

function safe(fn: () => void): void {
  try {
    fn();
  } catch {
    // listener errors must not poison the registry
  }
}
