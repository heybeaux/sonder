import type { ApprovalGate, SonderEvent, SonderEventCore } from './event.js';

/**
 * Sonder adapter interface. Adapters contribute to the cognitive-context
 * surface (`SonderEventCore`) during the synchronous contribute phase, and
 * observe the fully-built event during the async observe phase.
 *
 * Adapters MUST NOT touch chain/signature fields — those are owned by
 * the runtime emit pipeline (Spec 2 R3/R4).
 */
export interface SonderAdapter {
  name: string;
  version: string;
  contribute(event: Partial<SonderEventCore>): Promise<Partial<SonderEventCore>>;
  observe(event: SonderEvent): Promise<void>;
  /**
   * Spike A.5 — optional pre-emit gate check. Called by the emit pipeline
   * after `buildEnvelope` and before redaction. Returns the gate the
   * adapter wants to enforce, or null if no gate applies. If any adapter
   * returns a gate with `state: 'pending'`, the pipeline throws
   * `GatePendingError` and nothing is persisted.
   */
  checkGate?(event: Partial<SonderEventCore>): Promise<ApprovalGate | null>;
}
