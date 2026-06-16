/**
 * AOP (Agent Observation Protocol) v0.1 projection.
 *
 * Sonder is the *reference implementation* of AOP; this module is the proof.
 * It projects a persisted SonderEvent into a language-neutral AOP envelope
 * conforming to `aop/schema/v0.1/agent-observation-event.schema.json`.
 *
 * The projection is the spec/impl split made executable (see
 * docs/sonder-as-aop.md, ADR 0001):
 *  - Sonder-implementation fields (`version`, `chain_prev_hash`,
 *    `chain_self_hash`, `signature`) are NOT part of AOP. They are demoted
 *    into `metadata` so a conformant non-Sonder consumer never has to know
 *    about Sonder's tamper-evident chain.
 *  - `aop_version` and `trace_context` are the two additions AOP requires on
 *    top of the cognitive envelope.
 *
 * This module imports nothing from the gate/bus internals — it is a pure
 * transform over the already-built event, which is exactly why a non-Sonder
 * runtime could emit the same shape without depending on Sonder.
 */

import type {
  GovernanceContext,
  SonderEventCore,
  SonderEventAny,
} from './types/event.js';

/** AOP spec version this projection targets. */
export const AOP_VERSION = '0.1' as const;

/** OTel interop block — links a cognitive event to its execution span. */
export interface AopTraceContext {
  trace_id?: string;
  span_id?: string;
}

/**
 * AOP v0.1 envelope. Mirrors agent-observation-event.schema.json. Only the
 * five identity fields are guaranteed present; cognitive blocks are carried
 * through from the source event. `additionalProperties` is open in the schema,
 * so demoted Sonder fields ride in `metadata`.
 */
export interface AopEvent {
  aop_version: typeof AOP_VERSION;
  id: string;
  agent_id: string;
  task_id: string;
  parent_id?: string;
  timestamp: string;
  trace_context?: AopTraceContext;

  capabilities?: SonderEventCore['capabilities'];
  memory?: SonderEventCore['memory'];
  reasoning?: SonderEventCore['reasoning'];
  governance?: GovernanceContext;
  prediction?: SonderEventCore['prediction'];
  intent?: SonderEventCore['intent'];

  outcome?: SonderEventCore['outcome'];
  resources?: string[];
  paths?: string[];

  payload?: unknown;
  metadata?: Record<string, unknown>;
}

export interface ToAopOptions {
  /** OTel trace/span IDs to attach. Sonder does not own these; the caller
   *  (a runtime with an execution-layer tracer) supplies them. */
  trace_context?: AopTraceContext;
}

/** Keys that are Sonder-implementation concerns, demoted out of the AOP top level. */
const SONDER_IMPL_KEYS = [
  'version',
  'chain_prev_hash',
  'chain_self_hash',
  'signature',
] as const;

/**
 * Project any persisted Sonder event (v1 or v2) into an AOP v0.1 envelope.
 *
 * Pure and total: never throws, never mutates the input. Chain/signature/version
 * fields are moved under `metadata.sonder` so the envelope is conformant while
 * the Sonder-specific provenance remains recoverable for a Sonder consumer.
 */
export function toAopEvent(event: SonderEventAny, options: ToAopOptions = {}): AopEvent {
  const src = event as unknown as Record<string, unknown>;
  const {
    id,
    agent_id,
    task_id,
    parent_id,
    timestamp,
    capabilities,
    memory,
    reasoning,
    governance,
    prediction,
    intent,
    outcome,
    resources,
    paths,
    payload,
    metadata,
    ...rest
  } = event;

  // Quarantine EVERY non-spec field — the known Sonder-impl keys
  // (version/chain_*/signature) plus any other producer-added field in `rest`
  // — into metadata.sonder. The AOP spec says impl provenance MUST NOT appear
  // at the top level, so a spec-clean envelope is the default, not an opt-in.
  // (Previously only the four known impl keys were demoted and `rest` leaked to
  // the top level — the spec-violation-by-default the adversarial review flagged.)
  const sonderProvenance: Record<string, unknown> = {};
  for (const key of SONDER_IMPL_KEYS) {
    if (key in src && src[key] !== undefined) sonderProvenance[key] = src[key];
  }
  for (const [k, v] of Object.entries(rest as Record<string, unknown>)) {
    if (v !== undefined && !(SONDER_IMPL_KEYS as readonly string[]).includes(k)) {
      sonderProvenance[k] = v;
    }
  }

  // Merge into an existing metadata.sonder namespace rather than clobbering it.
  let mergedMetadata: Record<string, unknown> | undefined;
  const hasProvenance = Object.keys(sonderProvenance).length > 0;
  if (metadata !== undefined || hasProvenance) {
    mergedMetadata = { ...(metadata ?? {}) };
    if (hasProvenance) {
      const existing = mergedMetadata.sonder;
      mergedMetadata.sonder =
        existing && typeof existing === 'object' && !Array.isArray(existing)
          ? { ...(existing as Record<string, unknown>), ...sonderProvenance }
          : sonderProvenance;
    }
  }

  const aop: AopEvent = {
    aop_version: AOP_VERSION,
    id,
    agent_id,
    task_id,
    timestamp,
  };

  if (parent_id !== undefined) aop.parent_id = parent_id;
  if (options.trace_context !== undefined) aop.trace_context = options.trace_context;

  if (capabilities !== undefined) aop.capabilities = capabilities;
  if (memory !== undefined) aop.memory = memory;
  if (reasoning !== undefined) aop.reasoning = reasoning;
  if (governance !== undefined) aop.governance = governance;
  if (prediction !== undefined) aop.prediction = prediction;
  if (intent !== undefined) aop.intent = intent;

  if (outcome !== undefined) aop.outcome = outcome;
  if (resources !== undefined) aop.resources = resources;
  if (paths !== undefined) aop.paths = paths;

  if (payload !== undefined) aop.payload = payload;
  if (mergedMetadata !== undefined) aop.metadata = mergedMetadata;

  return aop;
}

/**
 * Focused projection for the Lattice gate-registry credibility path: produce
 * the minimal AOP-conformant *governance* observation from a Sonder event.
 *
 * This is the "governance" conformance tier from docs/sonder-as-aop.md — a
 * consumer that only cares about policy/gate decisions gets identity +
 * governance without the rest of the cognitive envelope. It is the concrete
 * answer to "can Lattice's gate decisions be read as AOP?": yes, this is the
 * read.
 */
export type AopGovernanceObservation = Pick<
  AopEvent,
  'aop_version' | 'id' | 'agent_id' | 'task_id' | 'timestamp'
> &
  Partial<Pick<AopEvent, 'parent_id' | 'trace_context' | 'governance'>>;

export function projectGovernanceObservation(
  event: SonderEventAny,
  options: ToAopOptions = {},
): AopGovernanceObservation {
  const full = toAopEvent(event, options);
  const minimal: AopGovernanceObservation = {
    aop_version: full.aop_version,
    id: full.id,
    agent_id: full.agent_id,
    task_id: full.task_id,
    timestamp: full.timestamp,
  };
  if (full.governance !== undefined) minimal.governance = full.governance;
  if (full.parent_id !== undefined) minimal.parent_id = full.parent_id;
  if (full.trace_context !== undefined) minimal.trace_context = full.trace_context;
  return minimal;
}
