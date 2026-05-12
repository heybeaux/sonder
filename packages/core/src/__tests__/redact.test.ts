import { describe, it, expect } from 'vitest';
import {
  redactJson,
  redactSonderEvent,
  RedactionRefusedError,
  DEFAULT_MUST_NOT_REDACT,
  conditionalGovernanceFields,
  validateMustNotRedactOverride,
} from '../redact.js';

/**
 * Test fixture for a v2-ready (pre-chain, pre-sign) SonderEvent.
 * Includes all the audit-critical fields that must survive redaction.
 */
function baseEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'evt-1',
    version: '2',
    agent_id: 'agent-x',
    task_id: 'task-1',
    timestamp: '2026-05-12T00:00:00Z',
    capabilities: { mounted: [], resolution: {}, budget_used: 0, budget_limit: 0 },
    memory: { refs: [], confidence: 0 },
    reasoning: { model: 'claude', neurotypes: [], consensus: true, dissent: [], osi: 0.1, rounds: 1 },
    governance: {
      contract_id: 'c1',
      validated: true,
      l1_pass: true,
      l2_pass: true,
      l3_pass: true,
      violations: [],
      circuit_state: 'closed',
    },
    prediction: { outcome: '', confidence: 0, alpha: 1, beta: 1, model_id: '' },
    intent: { action: 'do', step_trace_id: 'trace-1', skipped: false, constraint_injected: false },
    payload: {},
    ...overrides,
  };
}

describe('redactJson — primitive (inlined from lattice-core)', () => {
  it('returns input untouched when no secrets present', () => {
    const r = redactJson({ a: 1, b: 'hello' }, { sensitivityLevel: 'high' });
    expect(r.fields).toEqual([]);
    expect(r.redacted).toEqual({ a: 1, b: 'hello' });
  });

  it('redacts a known sensitive key name', () => {
    const r = redactJson({ password: 'hunter2' }, { sensitivityLevel: 'high' });
    expect(r.fields).toContain('$.password');
    expect((r.redacted as Record<string, unknown>).password).toBe('[REDACTED]');
  });

  it('redacts email at high sensitivity', () => {
    const r = redactJson({ note: 'contact me at alice@example.com' }, { sensitivityLevel: 'high' });
    expect(r.fields).toContain('$.note');
    expect((r.redacted as Record<string, unknown>).note).not.toContain('alice@');
  });

  it('does not redact email at low sensitivity', () => {
    const r = redactJson({ note: 'contact me at alice@example.com' }, { sensitivityLevel: 'low' });
    expect(r.fields).not.toContain('$.note');
  });

  it('refuses when redaction would land on a must-not-redact path', () => {
    const r = redactJson(
      { password: 'hunter2' },
      { sensitivityLevel: 'high', mustNotRedact: ['$.password'] },
    );
    expect(r.refusalPath).toBe('$.password');
  });
});

describe('redactSonderEvent', () => {
  it('redacts email + phone + SSN in payload at default sensitivity (high)', () => {
    const event = baseEvent({
      payload: {
        email: 'alice@example.com',
        phone: '555-123-4567',
        ssn: '123-45-6789',
      },
    });
    const { redacted, evidence } = redactSonderEvent(event);
    expect(evidence.sensitivityLevel).toBe('high');
    expect(evidence.count).toBeGreaterThanOrEqual(3);
    // All three should be redacted (either via key-name or pattern sweep).
    const payload = (redacted as { payload: Record<string, unknown> }).payload;
    expect(JSON.stringify(payload)).not.toContain('alice@example.com');
    expect(JSON.stringify(payload)).not.toContain('123-45-6789');
    expect(JSON.stringify(payload)).not.toContain('555-123-4567');
    // The fields list contains the JSONPaths, not the values.
    for (const f of evidence.fields) {
      expect(f.startsWith('$.')).toBe(true);
      expect(f).not.toContain('alice');
      expect(f).not.toContain('555');
    }
  });

  it('emits an empty evidence block when nothing was redacted', () => {
    const event = baseEvent({ payload: 'hello world' });
    const { evidence } = redactSonderEvent(event);
    expect(evidence.fields).toEqual([]);
    expect(evidence.count).toBe(0);
  });

  it('refuses when a default must-not-redact field would be masked', () => {
    // Inject a key name into agent_id that matches the credential pattern.
    // The actual agent_id value is sensitive-looking on its own.
    // We force the issue by passing an extra allowlisted key name via the
    // public `mustNotRedact` (this test exercises the must-not-redact loop).
    // Easiest: build an event where `governance.contract_id` becomes null
    // post-redaction. Use an event with `contract_id` value that matches
    // an OpenAI sk- pattern — pattern sweep would replace it, but we
    // require it to survive.
    const event = baseEvent({
      governance: {
        ...((baseEvent().governance) as Record<string, unknown>),
        contract_id: 'sk-proj-abcdefghijklmnopqrstuvwxyz1234567890',
      },
    });
    expect(() => redactSonderEvent(event)).toThrow(RedactionRefusedError);
    try {
      redactSonderEvent(event);
    } catch (err) {
      expect((err as RedactionRefusedError).path).toBe('$.governance.contract_id');
      expect((err as RedactionRefusedError).code).toBe('must-not-redact-field-missing');
    }
  });

  it('refuses when a default must-not-redact field is missing on input', () => {
    const event = baseEvent();
    delete (event as Record<string, unknown>).agent_id;
    expect(() => redactSonderEvent(event)).toThrow(/must-not-redact-field-missing/);
  });

  it('conditional governance fields surface only when tier is present', () => {
    const noTier = baseEvent();
    expect(conditionalGovernanceFields(noTier)).toEqual([]);

    const withTier = baseEvent({
      governance: { ...(baseEvent().governance as object), tier: 'L0+L1' },
    });
    expect(conditionalGovernanceFields(withTier)).toEqual([
      '$.governance.tier',
      '$.governance.evidence',
    ]);
  });

  it('with tier present, refuses if governance.evidence is masked away', () => {
    // governance.evidence is an array of PolicyEvidenceRow objects.
    // We deliberately set evidence to null so the post-redaction check
    // surfaces the failure.
    const event = baseEvent({
      governance: {
        ...(baseEvent().governance as object),
        tier: 'L0+L1',
        evidence: null,
      },
    });
    expect(() => redactSonderEvent(event)).toThrow(/governance\.evidence/);
  });

  it('with tier absent, governance.evidence-absent does NOT refuse', () => {
    const event = baseEvent(); // no tier, no evidence
    expect(() => redactSonderEvent(event)).not.toThrow();
  });

  it('is deterministic — same input -> same output (100 iterations)', () => {
    const event = baseEvent({
      payload: { email: 'foo@bar.com', note: 'call me at +1 555 123 4567' },
    });
    const first = redactSonderEvent(event);
    for (let i = 0; i < 100; i++) {
      const r = redactSonderEvent(event);
      expect(JSON.stringify(r.redacted)).toBe(JSON.stringify(first.redacted));
      expect(r.evidence.fields).toEqual(first.evidence.fields);
      expect(r.evidence.count).toBe(first.evidence.count);
    }
  });

  it('does not mutate the input event', () => {
    const event = baseEvent({ payload: { email: 'alice@example.com' } });
    const before = JSON.stringify(event);
    redactSonderEvent(event);
    expect(JSON.stringify(event)).toBe(before);
  });
});

describe('DEFAULT_MUST_NOT_REDACT + override validation', () => {
  it('default list matches the design.md allowlist', () => {
    expect(DEFAULT_MUST_NOT_REDACT).toEqual([
      '$.id',
      '$.agent_id',
      '$.task_id',
      '$.timestamp',
      '$.version',
      '$.governance.contract_id',
      '$.governance.validated',
      '$.governance.l1_pass',
      '$.governance.l2_pass',
      '$.governance.l3_pass',
      '$.governance.circuit_state',
      '$.reasoning.consensus',
      '$.reasoning.osi',
      '$.reasoning.rounds',
      '$.intent.action',
      '$.intent.step_trace_id',
    ]);
  });

  it('validateMustNotRedactOverride accepts the full default list', () => {
    expect(() => validateMustNotRedactOverride(DEFAULT_MUST_NOT_REDACT)).not.toThrow();
  });

  it('validateMustNotRedactOverride accepts default + extras', () => {
    expect(() =>
      validateMustNotRedactOverride([...DEFAULT_MUST_NOT_REDACT, '$.payload.contract_hash']),
    ).not.toThrow();
  });

  it('validateMustNotRedactOverride throws when a default path is removed', () => {
    const stripped = DEFAULT_MUST_NOT_REDACT.filter((p) => p !== '$.agent_id');
    expect(() => validateMustNotRedactOverride(stripped)).toThrow(
      /must-not-redact override removed required path: \$\.agent_id/,
    );
  });
});
