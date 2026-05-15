/**
 * Spike A.5 — pre-emit approval gate.
 *
 * Adapter-driven gating that aborts the emit pipeline before persistence.
 * Sonder owns the mechanism (this module); Lattice / AWM / any policy
 * adapter owns when to open a gate (by implementing `checkGate`).
 */

import type { SonderAdapter } from './types/adapter.js';
import type {
  ApprovalGate,
  SonderEventCore,
} from './types/event.js';

/**
 * Thrown by the emit pipeline when at least one adapter returned an
 * `approval_gate` with `state: 'pending'`. The pipeline aborts before
 * redaction/persistence — no audit row is written.
 *
 * The caller (Ginnung cockpit, agent runtime, etc.) is expected to
 * resolve the gate via the adapter's external API and then retry the
 * original emit.
 */
export class GatePendingError extends Error {
  readonly name = 'GatePendingError';
  readonly gate: ApprovalGate;
  /** Name of the adapter that opened the gate, for diagnosis. */
  readonly adapterName: string;

  constructor(adapterName: string, gate: ApprovalGate) {
    super(
      `Gate '${gate.gate_id}' pending (opened by ${adapterName}): ${gate.reason ?? 'no reason given'}`,
    );
    this.adapterName = adapterName;
    this.gate = gate;
  }
}

/**
 * Run every adapter's optional `checkGate` against the built envelope.
 * Returns the first pending gate found, or null if no adapter is gating.
 *
 * Order matches adapter registration order. We intentionally do NOT
 * surface multiple gates at once — the cockpit resolves one at a time
 * and a subsequent retry will surface the next pending gate (if any).
 *
 * Allowed and denied gates are returned to the caller via the envelope
 * (`governance.approval_gate`) but do NOT abort the pipeline. A 'denied'
 * gate means the policy actively rejected the action — the emit still
 * goes through and the denial is recorded in the audit log; it's the
 * agent runtime's job to honor the denial.
 */
export async function findPendingGate(
  adapters: readonly SonderAdapter[],
  envelope: Partial<SonderEventCore>,
): Promise<{ adapterName: string; gate: ApprovalGate } | null> {
  for (const adapter of adapters) {
    if (!adapter.checkGate) continue;
    const gate = await adapter.checkGate(envelope);
    if (!gate) continue;
    if (gate.state === 'pending') {
      return { adapterName: adapter.name, gate };
    }
  }
  return null;
}
