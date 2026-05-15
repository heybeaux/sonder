/**
 * v2 emit pipeline (Spec 2 Task 7).
 *
 * Order:
 *   1. Build the cognitive-context envelope via `bus.buildEnvelope` (adapters
 *      run; resulting object is a v1-shaped event missing the chain/sign
 *      fields).
 *   2. Redact via `redactSonderEvent`. Throws RedactionRefusedError on a
 *      must-not-redact violation — pipeline aborts; nothing persisted.
 *   3. Run `validateL0EvidenceOrThrow` (Spec 2 R12). Throws SignRefusedError
 *      when L1/L2/L3 tier is claimed without evidence.
 *   4. Open an IMMEDIATE tx on the audit log. Inside:
 *      a. Read `chain_prev_hash` via `readPrevHashForNextEvent` (serialized
 *         per agent — R6).
 *      b. Stamp `chain_self_hash`.
 *      c. Sign — produces the base64 signature over the canonicalized
 *         event with chain_self_hash present.
 *      d. Persist via `bus.persistSigned`, which writes the row and
 *         records the genesis on first event for the agent.
 *   5. Return the signed event.
 *
 * Failure at any step does NOT persist. All errors bubble to the caller.
 */

import type { KeyObject } from 'node:crypto';
import {
  type SonderBus,
  type SonderEventV2,
  type SonderEventCore,
  type SensitivityLevel,
  type RedactSonderEventOptions,
  GatePendingError,
  findPendingGate,
  redactSonderEvent,
  validateL0EvidenceOrThrow,
  validateMustNotRedactOverride,
  readPrevHashForNextEvent,
  stampChainHashes,
  sign,
} from '@heybeaux/sonder-core';

export interface EmitPipelineConfig {
  bus: SonderBus;
  /** Loaded ed25519 keypair (used by sign step). */
  privateKey: KeyObject;
  /** Base64 ed25519 public key — surfaced via runtime.publicKey. */
  publicKeyBase64: string;
  /** Redaction config. */
  redaction?: {
    sensitivityLevel?: SensitivityLevel;
    /**
     * Full operator-supplied allowlist. MUST include every entry in
     * DEFAULT_MUST_NOT_REDACT; the pipeline validates this at config
     * time (R8). When omitted, DEFAULT_MUST_NOT_REDACT is used as-is.
     */
    mustNotRedact?: readonly string[];
  };
}

export interface EmitPipeline {
  /**
   * Emit a v2 SonderEvent. Builds the envelope through registered
   * adapters, runs the full pipeline, and persists the signed event.
   */
  emit(
    base: Pick<SonderEventCore, 'agent_id' | 'task_id' | 'payload'> &
      Partial<Omit<SonderEventCore, 'id' | 'timestamp'>>,
  ): Promise<SonderEventV2>;
}

export function createEmitPipeline(config: EmitPipelineConfig): EmitPipeline {
  const { bus, privateKey } = config;

  // R8 — validate operator allowlist at construction time.
  if (config.redaction?.mustNotRedact) {
    validateMustNotRedactOverride(config.redaction.mustNotRedact);
  }
  const redactOpts: RedactSonderEventOptions = {};
  if (config.redaction?.sensitivityLevel) {
    redactOpts.sensitivityLevel = config.redaction.sensitivityLevel;
  }
  if (config.redaction?.mustNotRedact) {
    redactOpts.mustNotRedact = config.redaction.mustNotRedact;
  }

  return {
    async emit(base) {
      // Step 1: build the envelope through adapters (v1 shape — no chain).
      const v1Envelope = await bus.buildEnvelope(base);

      // Step 1.5 (Spike A.5): pre-emit approval gate. Any adapter that
      // implements checkGate() can veto persistence by returning a gate
      // in 'pending' state. The pipeline aborts; no audit row is written.
      // Resolution happens out-of-band (Ginnung cockpit → adapter API),
      // after which the caller retries the emit.
      const pending = await findPendingGate(bus.getAdapters(), v1Envelope);
      if (pending) {
        throw new GatePendingError(pending.adapterName, pending.gate);
      }

      // Step 2: redact. RedactionRefusedError bubbles up.
      const { redacted, evidence } = redactSonderEvent(
        v1Envelope as unknown as Record<string, unknown>,
        redactOpts,
      );

      // Build the pre-sign v2 envelope: keep all redacted fields, drop the
      // version: '1' marker, set version: '2', and attach metadata.redaction.
      const preChain: Omit<SonderEventV2, 'chain_self_hash' | 'signature' | 'chain_prev_hash'> = {
        ...((redacted as unknown) as Omit<SonderEventCore, never>),
        version: '2' as const,
        metadata: {
          ...((redacted as { metadata?: Record<string, unknown> }).metadata ?? {}),
          redaction: evidence,
        },
      };

      // Step 3: L0 evidence enforcement. Drops the event if violated.
      validateL0EvidenceOrThrow(preChain as unknown as Record<string, unknown>);

      // Step 4: chain stamp + sign + persist — all inside IMMEDIATE tx.
      const signedEvent = bus.audit.immediate((): SonderEventV2 => {
        const prev = readPrevHashForNextEvent(bus.audit, preChain.agent_id, preChain.timestamp);
        const withPrev: Omit<SonderEventV2, 'chain_self_hash' | 'signature'> = {
          ...preChain,
          chain_prev_hash: prev,
        };
        const stamped = stampChainHashes(withPrev);
        const signature = sign(stamped as unknown as Record<string, unknown>, privateKey);
        const signedV2: SonderEventV2 = { ...stamped, signature };
        bus.persistSigned(signedV2);
        return signedV2;
      });

      return signedEvent;
    },
  };
}
