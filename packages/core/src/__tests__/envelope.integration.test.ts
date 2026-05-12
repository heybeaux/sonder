import { describe, it, expect } from 'vitest';
import { SonderBus } from '../bus.js';
import type { SonderAdapter, SonderEvent } from '../index.js';

// Minimal adapter builder — contributes a fixed partial, observe is no-op.
function makeAdapter(name: string, contribution: Partial<SonderEvent>): SonderAdapter {
  return {
    name,
    version: '0.1.0',
    async contribute(event) { return { ...event, ...contribution }; },
    async observe() {},
  };
}

const BASE = { agent_id: 'agent-test', task_id: 'task-test', payload: null };

describe('SonderEvent envelope — spec compliance', () => {
  it('ACR: mounted capability appears in event.capabilities', async () => {
    const bus = new SonderBus();
    bus.register(makeAdapter('acr', {
      capabilities: {
        mounted: ['web-search'],
        resolution: { 'web-search': 'standard' },
        budget_used: 1250,
        budget_limit: 8000,
      },
    }));
    const event = await bus.emit(BASE);
    expect(event.capabilities.mounted).toContain('web-search');
    expect(event.capabilities.resolution['web-search']).toBe('standard');
    expect(event.capabilities.budget_used).toBe(1250);
    bus.close();
  });

  it('Engram: memory refs and confidence appear in event.memory', async () => {
    const bus = new SonderBus();
    bus.register(makeAdapter('engram', {
      memory: { refs: ['mem_01', 'mem_02'], confidence: 0.87 },
    }));
    const event = await bus.emit(BASE);
    expect(event.memory.refs).toEqual(['mem_01', 'mem_02']);
    expect(event.memory.confidence).toBe(0.87);
    bus.close();
  });

  it('Parliament: dissent and rounds appear in event.reasoning', async () => {
    const bus = new SonderBus();
    bus.register(makeAdapter('parliament', {
      reasoning: {
        model: 'claude-sonnet-4-6',
        neurotypes: ['Proposer', 'Skeptic', 'Empiricist'],
        consensus: false,
        dissent: ['Skeptic'],
        osi: 0.34,
        rounds: 3,
      },
    }));
    const event = await bus.emit(BASE);
    expect(event.reasoning.consensus).toBe(false);
    expect(event.reasoning.dissent).toContain('Skeptic');
    expect(event.reasoning.rounds).toBe(3);
    expect(event.reasoning.osi).toBeGreaterThan(0);
    bus.close();
  });

  it('Lattice: validation failure populates violations and circuit_state', async () => {
    const bus = new SonderBus();
    bus.register(makeAdapter('lattice', {
      governance: {
        contract_id: 'handoff-v1',
        validated: false,
        l1_pass: false,
        l2_pass: true,
        l3_pass: true,
        violations: ['L1_TYPE_MISMATCH'],
        circuit_state: 'open',
      },
    }));
    const event = await bus.emit(BASE);
    expect(event.governance.validated).toBe(false);
    expect(event.governance.l1_pass).toBe(false);
    expect(event.governance.violations).toContain('L1_TYPE_MISMATCH');
    expect(event.governance.circuit_state).toBe('open');
    bus.close();
  });

  it('LeWM: Beta distribution parameters appear in event.prediction', async () => {
    const bus = new SonderBus();
    bus.register(makeAdapter('lewm', {
      prediction: {
        outcome: 'success',
        confidence: 0.84,
        alpha: 42,
        beta: 8,
        model_id: 'lewm-v1',
      },
    }));
    const event = await bus.emit(BASE);
    expect(event.prediction.outcome).toBe('success');
    expect(event.prediction.confidence).toBe(0.84);
    expect(event.prediction.alpha).toBe(42);
    expect(event.prediction.beta).toBe(8);
    bus.close();
  });

  it('AWM: skipped step with constraint injection appears in event.intent', async () => {
    const bus = new SonderBus();
    bus.register(makeAdapter('awm', {
      intent: {
        action: 'validate-output',
        step_trace_id: 'trace-001',
        skipped: true,
        skip_reason: 'prediction_confidence_above_threshold_0.95',
        constraint_injected: true,
      },
    }));
    const event = await bus.emit(BASE);
    expect(event.intent.skipped).toBe(true);
    expect(event.intent.skip_reason).toContain('0.95');
    expect(event.intent.constraint_injected).toBe(true);
    bus.close();
  });

  it('missing adapter: defaults to empty memory section, emission succeeds', async () => {
    const bus = new SonderBus();
    // Only ACR and Lattice registered — no Engram
    bus.register(makeAdapter('acr', { capabilities: { mounted: ['web-search'], resolution: {}, budget_used: 0, budget_limit: 0 } }));
    bus.register(makeAdapter('lattice', { governance: { contract_id: 'c1', validated: true, l1_pass: true, l2_pass: true, l3_pass: true, violations: [], circuit_state: 'closed' } }));
    const event = await bus.emit(BASE);
    expect(event.memory.refs).toEqual([]);
    expect(event.memory.confidence).toBe(0);
    bus.close();
  });

  it('envelope structure: every event has id, version, agent_id, task_id, timestamp', async () => {
    const bus = new SonderBus();
    const event = await bus.emit(BASE);
    expect(event.id).toBeTruthy();
    expect(event.version).toBe('1');
    expect(event.agent_id).toBe('agent-test');
    expect(event.task_id).toBe('task-test');
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    bus.close();
  });

  it('ULID: consecutive IDs are lexicographically sortable', async () => {
    const bus = new SonderBus();
    const a = await bus.emit(BASE);
    const b = await bus.emit(BASE);
    expect(b.id > a.id).toBe(true);
    bus.close();
  });

  it('serialization: event round-trips through JSON without data loss', async () => {
    const bus = new SonderBus();
    bus.register(makeAdapter('engram', {
      memory: { refs: ['mem_abc'], query: 'test query', confidence: 0.75 },
    }));
    const event = await bus.emit(BASE);
    const roundTripped = JSON.parse(JSON.stringify(event)) as SonderEvent;
    expect(roundTripped.memory.refs).toEqual(['mem_abc']);
    expect(roundTripped.memory.query).toBe('test query');
    expect(roundTripped.id).toBe(event.id);
    bus.close();
  });

  it('audit log: emitted events are queryable by task_id', async () => {
    const bus = new SonderBus();
    await bus.emit({ agent_id: 'agent-a', task_id: 'task-alpha', payload: 1 });
    await bus.emit({ agent_id: 'agent-b', task_id: 'task-beta', payload: 2 });
    const results = bus.query({ task_id: 'task-alpha' });
    expect(results).toHaveLength(1);
    expect(results[0]?.agent_id).toBe('agent-a');
    bus.close();
  });
});
