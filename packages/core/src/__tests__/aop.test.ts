/**
 * AOP v0.1 projection conformance.
 *
 * Proves the spec/impl split is real: a projected Sonder event validates
 * against the published JSON Schema (aop/schema/v0.1/...), and the
 * Sonder-implementation fields (version/chain/signature) never leak into the
 * AOP top level. This is the "Lattice gate registry → AOP governance"
 * credibility path made executable (docs/sonder-as-aop.md).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { describe, it, expect, beforeAll } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import * as addFormatsNs from 'ajv-formats';
import type { ValidateFunction } from 'ajv';

// ajv-formats default export is the callable plugin; under NodeNext the
// namespace surfaces it on `.default`.
const addFormats = (addFormatsNs as unknown as { default: typeof import('ajv-formats').default })
  .default;

import { toAopEvent, projectGovernanceObservation, AOP_VERSION } from '../aop.js';
import type { SonderEventV1, SonderEventV2 } from '../types/event.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(
  __dirname,
  '../../../../aop/schema/v0.1/agent-observation-event.schema.json',
);

let validate: ValidateFunction;

beforeAll(() => {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  validate = ajv.compile(schema);
});

const baseCore = {
  capabilities: { mounted: [], resolution: {}, budget_used: 0, budget_limit: 10 },
  memory: { refs: [], confidence: 0.5 },
  reasoning: { model: 'x', neurotypes: [], consensus: true, dissent: [], osi: 0, rounds: 1 },
  prediction: { outcome: 'ok', confidence: 0.9, alpha: 9, beta: 1, model_id: 'm' },
  intent: { action: 'write', step_trace_id: 's1', skipped: false, constraint_injected: false },
};

/** A v2 event whose governance carries L1 tier + evidence + an approval gate —
 *  the richest Lattice/Aegis governance shape. */
function v2WithGovernance(): SonderEventV2 {
  return {
    version: '2',
    id: '01J0000000000000000000000A',
    agent_id: 'kit',
    task_id: 'task-42',
    parent_id: '01J0000000000000000000000P',
    timestamp: '2026-06-15T21:00:00.000Z',
    ...baseCore,
    governance: {
      contract_id: 'contract-7',
      validated: true,
      l1_pass: true,
      l2_pass: true,
      l3_pass: false,
      violations: ['l3:budget-exceeded'],
      circuit_state: 'half-open',
      tier: 'L0+L1',
      evidence: [
        { rule_id: 'r1', rule_kind: 'path-allow', path: '/src', outcome: 'pass' },
        { rule_id: 'r2', rule_kind: 'secret-mask', outcome: 'mask', matched: 'API_KEY' },
      ],
      approval_gate: {
        state: 'pending',
        gate_id: 'gate-9',
        reason: 'writes outside contract scope',
        default_action: 'deny',
        expires_at: '2026-06-15T21:05:00.000Z',
      },
    },
    payload: { cmd: 'rm -rf build' },
    metadata: { redaction: { fields: [], count: 0, sensitivityLevel: 'low' } },
    chain_prev_hash: 'aa',
    chain_self_hash: 'bb',
    signature: 'cc',
  };
}

describe('toAopEvent — conformance', () => {
  it('projects a v2 governance event that validates against AOP v0.1 schema', () => {
    const aop = toAopEvent(v2WithGovernance());
    const ok = validate(aop);
    if (!ok) throw new Error(JSON.stringify(validate.errors, null, 2));
    expect(ok).toBe(true);
    expect(aop.aop_version).toBe(AOP_VERSION);
  });

  it('demotes Sonder-impl fields out of the AOP top level into metadata.sonder', () => {
    const aop = toAopEvent(v2WithGovernance()) as unknown as Record<string, unknown>;
    expect(aop.version).toBeUndefined();
    expect(aop.chain_prev_hash).toBeUndefined();
    expect(aop.chain_self_hash).toBeUndefined();
    expect(aop.signature).toBeUndefined();

    const sonder = (aop.metadata as Record<string, unknown>).sonder as Record<string, unknown>;
    expect(sonder.version).toBe('2');
    expect(sonder.chain_self_hash).toBe('bb');
    expect(sonder.signature).toBe('cc');
  });

  it('preserves the full Lattice governance block verbatim', () => {
    const src = v2WithGovernance();
    const aop = toAopEvent(src);
    expect(aop.governance).toEqual(src.governance);
  });

  it('quarantines unknown non-spec producer fields instead of leaking them to the top level', () => {
    const src = { ...v2WithGovernance(), futureProducerField: 'should-not-leak' } as SonderEventV2;
    const aop = toAopEvent(src) as unknown as Record<string, unknown>;
    expect(aop.futureProducerField).toBeUndefined();
    const sonder = (aop.metadata as Record<string, unknown>).sonder as Record<string, unknown>;
    expect(sonder.futureProducerField).toBe('should-not-leak');
    expect(validate(aop)).toBe(true);
  });

  it('merges provenance into existing metadata.sonder without clobbering caller metadata', () => {
    // v2WithGovernance carries metadata.redaction — it must survive demotion.
    const aop = toAopEvent(v2WithGovernance());
    const meta = aop.metadata as Record<string, unknown>;
    expect(meta.redaction).toBeDefined();
    expect((meta.sonder as Record<string, unknown>).signature).toBe('cc');
  });

  it('attaches trace_context when supplied (external trace interop)', () => {
    const aop = toAopEvent(v2WithGovernance(), {
      trace_context: { trace_id: 't-1', span_id: 's-1' },
    });
    expect(validate(aop)).toBe(true);
    expect(aop.trace_context).toEqual({ trace_id: 't-1', span_id: 's-1' });
  });

  it('projects a legacy v1 event without chain fields', () => {
    const v1: SonderEventV1 = {
      version: '1',
      id: '01J0000000000000000000000B',
      agent_id: 'kit',
      task_id: 't',
      timestamp: '2026-06-15T21:00:00.000Z',
      ...baseCore,
      governance: {
        contract_id: 'c1',
        validated: true,
        l1_pass: true,
        l2_pass: true,
        l3_pass: true,
        violations: [],
        circuit_state: 'closed',
      },
      payload: null,
    };
    const aop = toAopEvent(v1);
    expect(validate(aop)).toBe(true);
    expect((aop.metadata as Record<string, unknown>).sonder).toEqual({ version: '1' });
  });

  it('is pure — does not mutate the source event', () => {
    const src = v2WithGovernance();
    const snapshot = JSON.parse(JSON.stringify(src));
    toAopEvent(src);
    expect(src).toEqual(snapshot);
  });
});

describe('projectGovernanceObservation — minimal tier', () => {
  it('produces a schema-valid identity+governance-only observation', () => {
    const obs = projectGovernanceObservation(v2WithGovernance());
    // The minimal projection must still validate against the full envelope
    // schema (governance tier = subset of required fields).
    expect(validate(obs)).toBe(true);
    const rec = obs as unknown as Record<string, unknown>;
    expect(rec.capabilities).toBeUndefined();
    expect(rec.memory).toBeUndefined();
    expect(obs.governance?.contract_id).toBe('contract-7');
    expect(obs.governance?.approval_gate?.gate_id).toBe('gate-9');
  });

  it('carries the L1 evidence rows required by the governance tier', () => {
    const obs = projectGovernanceObservation(v2WithGovernance());
    expect(obs.governance?.tier).toBe('L0+L1');
    expect(obs.governance?.evidence).toHaveLength(2);
    expect(obs.governance?.evidence?.[1]).toMatchObject({ outcome: 'mask', matched: 'API_KEY' });
  });
});
