/**
 * Envelope acceptance criteria from:
 * openspec/changes/sonder-agent-runtime/specs/envelope.md
 */
import { describe, it, expect } from 'vitest';
import { createRuntime } from '../runtime.js';
import type { SonderAdapter, SonderEvent } from '@heybeaux/sonder-core';

function adapterWith(patch: Partial<SonderEvent>): SonderAdapter {
  return {
    name: 'mock',
    version: '1',
    contribute: async (e) => ({ ...e, ...patch }),
    observe: async () => {},
  };
}

describe('Envelope acceptance criteria', () => {
  it('every SonderEvent has a unique lexicographically sortable ULID', async () => {
    const runtime = createRuntime();
    const e1 = await runtime.bus.emit({ agent_id: 'a', task_id: 't', payload: null });
    const e2 = await runtime.bus.emit({ agent_id: 'a', task_id: 't', payload: null });
    expect(e1.id).not.toBe(e2.id);
    expect(e1.id < e2.id).toBe(true); // lexicographic sort = chronological
    runtime.shutdown();
  });

  it('every SonderEvent carries typed sections for all six cognitive faculties', async () => {
    const runtime = createRuntime();
    const e = await runtime.bus.emit({ agent_id: 'a', task_id: 't', payload: null });
    expect(e.capabilities).toBeDefined();
    expect(e.memory).toBeDefined();
    expect(e.reasoning).toBeDefined();
    expect(e.governance).toBeDefined();
    expect(e.prediction).toBeDefined();
    expect(e.intent).toBeDefined();
    runtime.shutdown();
  });

  it('missing adapter sections default to empty — emission succeeds', async () => {
    // No adapters registered — should not throw
    const runtime = createRuntime();
    const e = await runtime.bus.emit({ agent_id: 'a', task_id: 't', payload: null });
    expect(e.memory.refs).toEqual([]);
    expect(e.memory.confidence).toBe(0);
    expect(e.governance.violations).toEqual([]);
    runtime.shutdown();
  });

  it('Engram scenario: memory refs and confidence are set correctly', async () => {
    const runtime = createRuntime({
      adapters: [adapterWith({ memory: { refs: ['mem_01', 'mem_02'], confidence: 0.87 } })],
    });
    const e = await runtime.bus.emit({ agent_id: 'a', task_id: 't', payload: null });
    expect(e.memory.refs).toEqual(['mem_01', 'mem_02']);
    expect(e.memory.confidence).toBe(0.87);
    runtime.shutdown();
  });

  it('Parliament scenario: dissent and consensus captured correctly', async () => {
    const runtime = createRuntime({
      adapters: [adapterWith({
        reasoning: {
          model: 'claude-opus-4-7',
          neurotypes: ['Proposer', 'Skeptic', 'Empiricist'],
          consensus: false,
          dissent: ['Skeptic'],
          osi: 0.22,
          rounds: 3,
        },
      })],
    });
    const e = await runtime.bus.emit({ agent_id: 'a', task_id: 't', payload: null });
    expect(e.reasoning.consensus).toBe(false);
    expect(e.reasoning.dissent).toContain('Skeptic');
    expect(e.reasoning.rounds).toBe(3);
    expect(e.reasoning.osi).toBeGreaterThan(0);
    runtime.shutdown();
  });

  it('Lattice scenario: governance violation sets validated=false and circuit open', async () => {
    const runtime = createRuntime({
      adapters: [adapterWith({
        governance: {
          contract_id: 'handoff-v1',
          validated: false,
          l1_pass: false,
          l2_pass: false,
          l3_pass: false,
          violations: ['L1_TYPE_MISMATCH'],
          circuit_state: 'open',
        },
      })],
    });
    const e = await runtime.bus.emit({ agent_id: 'a', task_id: 't', payload: null });
    expect(e.governance.validated).toBe(false);
    expect(e.governance.l1_pass).toBe(false);
    expect(e.governance.violations).toContain('L1_TYPE_MISMATCH');
    expect(e.governance.circuit_state).toBe('open');
    runtime.shutdown();
  });

  it('LeWM scenario: Beta distribution parameters are set correctly', async () => {
    const runtime = createRuntime({
      adapters: [adapterWith({
        prediction: { outcome: 'success', confidence: 0.84, alpha: 42, beta: 8, model_id: 'lewm-v1' },
      })],
    });
    const e = await runtime.bus.emit({ agent_id: 'a', task_id: 't', payload: null });
    expect(e.prediction.outcome).toBe('success');
    expect(e.prediction.confidence).toBe(0.84);
    expect(e.prediction.alpha).toBe(42);
    expect(e.prediction.beta).toBe(8);
    runtime.shutdown();
  });

  it('AWM scenario: skipped step with constraint injection', async () => {
    const runtime = createRuntime({
      adapters: [adapterWith({
        intent: {
          action: 'validate-output',
          step_trace_id: 'trace-001',
          skipped: true,
          skip_reason: 'confidence > 0.95 threshold',
          constraint_injected: true,
        },
      })],
    });
    const e = await runtime.bus.emit({ agent_id: 'a', task_id: 't', payload: null });
    expect(e.intent.skipped).toBe(true);
    expect(e.intent.skip_reason).toContain('0.95');
    expect(e.intent.constraint_injected).toBe(true);
    runtime.shutdown();
  });

  it('envelope is serializable to JSON with no loss of fidelity', async () => {
    const runtime = createRuntime();
    const e = await runtime.bus.emit({ agent_id: 'agent-1', task_id: 'task-1', payload: { hello: 'world' } });
    const json = JSON.stringify(e);
    const parsed = JSON.parse(json) as SonderEvent;
    expect(parsed.id).toBe(e.id);
    expect(parsed.agent_id).toBe(e.agent_id);
    expect(parsed.memory.refs).toEqual(e.memory.refs);
    expect(parsed.governance.violations).toEqual(e.governance.violations);
    runtime.shutdown();
  });
});
