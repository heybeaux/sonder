/**
 * emitWithGateRetry — agent-side retry loop for pre-emit gates.
 *
 * Wraps a single emit attempt. If the emit throws `GatePendingError`, polls
 * at `pollMs` (default 500ms) and retries until either:
 *   - the emit succeeds (gate resolved out-of-band, checkGate now passes)
 *   - the gate's `expires_at` is in the past (gate expired — final throw)
 *   - `timeoutMs` (default 5 min) elapses (final throw)
 *   - the emit throws something other than GatePendingError (rethrown)
 *
 * The polling shape is deliberately simple — no exponential backoff, no
 * jitter. v1 has one operator clicking Resume in a cockpit; we want the
 * agent unblocked within a heartbeat of the click. 500ms is a good
 * imperceptible latency without burning CPU.
 *
 * Returns whatever the emit returns. The caller is the agent framework
 * (or whatever owns the emit call site).
 */

import { GatePendingError } from './gate.js';

export interface EmitWithGateRetryOptions {
  /** Poll interval between retries, ms. Default 500. */
  pollMs?: number;
  /** Hard ceiling on total wait, ms. Default 5 minutes. */
  timeoutMs?: number;
  /**
   * Called once per pending wait (not per poll) — lets callers log that
   * they are blocked on a specific gate. Receives the `GatePendingError`.
   */
  onGate?: (err: GatePendingError) => void;
  /** Override for `Date.now` in tests. */
  now?: () => number;
  /** Override for `setTimeout` in tests. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

export class GateTimeoutError extends Error {
  readonly name = 'GateTimeoutError';
  readonly gate_id: string;
  constructor(gate_id: string, waitedMs: number) {
    super(`Gate '${gate_id}' did not resolve within ${waitedMs}ms`);
    this.gate_id = gate_id;
  }
}

export async function emitWithGateRetry<T>(
  emit: () => Promise<T>,
  options: EmitWithGateRetryOptions = {},
): Promise<T> {
  const pollMs = options.pollMs ?? 500;
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? defaultSleep;

  const start = now();
  let notifiedFor: string | null = null;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await emit();
    } catch (err) {
      if (!(err instanceof GatePendingError)) throw err;

      // First time seeing this gate id — let the caller record/log.
      if (notifiedFor !== err.gate.gate_id) {
        notifiedFor = err.gate.gate_id;
        options.onGate?.(err);
      }

      // Expired? Stop retrying — the next emit will produce a fresh gate
      // anyway if the policy still applies.
      if (err.gate.expires_at && Date.parse(err.gate.expires_at) <= now()) {
        throw new GateTimeoutError(err.gate.gate_id, now() - start);
      }

      // Overall timeout?
      if (now() - start >= timeoutMs) {
        throw new GateTimeoutError(err.gate.gate_id, now() - start);
      }

      await sleep(pollMs);
    }
  }
}
