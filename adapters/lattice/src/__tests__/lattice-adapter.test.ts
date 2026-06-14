import { describe, it, expect } from 'vitest';
import { AegisAdapter, LatticeAdapter } from '../index.js';
import type { ApprovalGate, GovernanceContext, PolicyEvidenceRow } from '@heybeaux/sonder-core';
import type { StateContract } from '@heybeaux/lattice-core';

const mockContract = {
  id: 'contract-123',
  schemaVersion: '0.1.0',
  traceId: 'trace-abc',
  parentIds: [],
  agentId: 'agent-1',
  task: 'test task',
  inputs: { payload: {}, contentType: 'application/json' },
  outputs: { payload: {}, contentType: 'application/json' },
  decisions: [],
  constraints: [],
  assumptions: [],
  metadata: {},
  timestamp: new Date().toISOString(),
} as unknown as StateContract;

describe('LatticeAdapter', () => {
  it('contributes empty governance when no active contract', async () => {
    const adapter = new LatticeAdapter({ getContract: () => null });
    const result = await adapter.contribute({});
    expect(result.governance?.contract_id).toBe('');
    expect(result.governance?.validated).toBe(false);
    expect(result.governance?.circuit_state).toBe('closed');
  });

  it('contributes contract_id from active contract', async () => {
    const adapter = new LatticeAdapter({ getContract: () => mockContract });
    const result = await adapter.contribute({});
    expect(result.governance?.contract_id).toBe('contract-123');
  });

  it('contributes circuit state from callback', async () => {
    const adapter = new LatticeAdapter({
      getContract: () => mockContract,
      getCircuitState: () => 'open',
    });
    const result = await adapter.contribute({});
    expect(result.governance?.circuit_state).toBe('open');
  });

  it('contributes validation snapshot when provided', async () => {
    const adapter = new LatticeAdapter({
      getContract: () => mockContract,
      getLastValidation: () => ({
        validated: true,
        l1_pass: true,
        l2_pass: true,
        l3_pass: false,
        violations: ['L3_CONFIDENCE_LOW'],
      }),
    });
    const result = await adapter.contribute({});
    expect(result.governance?.validated).toBe(true);
    expect(result.governance?.l3_pass).toBe(false);
    expect(result.governance?.violations).toEqual(['L3_CONFIDENCE_LOW']);
  });

  it('defaults to closed circuit and no violations when callbacks omitted', async () => {
    const adapter = new LatticeAdapter({ getContract: () => mockContract });
    const result = await adapter.contribute({});
    expect(result.governance?.circuit_state).toBe('closed');
    expect(result.governance?.violations).toEqual([]);
  });

  it('observe is a no-op', async () => {
    const adapter = new LatticeAdapter({ getContract: () => null });
    await expect(adapter.observe({} as never)).resolves.toBeUndefined();
  });
});

describe('AegisAdapter (Phase 3.5 — governance verdict + evidence)', () => {
  const gate: ApprovalGate = {
    state: 'allowed',
    gate_id: 'gate-1',
    default_action: 'deny',
    reason: 'auto-approved by policy',
  };
  const evidence: PolicyEvidenceRow[] = [
    { rule_id: 'r1', rule_kind: 'allow', outcome: 'pass' },
  ];

  it('contributes nothing when getGovernance returns null', async () => {
    const adapter = new AegisAdapter({ getGovernance: () => null });
    const result = await adapter.contribute({ payload: null });
    expect(result.governance).toBeUndefined();
  });

  it('stamps approval_gate + evidence onto governance', async () => {
    const adapter = new AegisAdapter({ getGovernance: () => ({ approval_gate: gate, evidence }) });
    const result = await adapter.contribute({ payload: null });
    expect(result.governance?.approval_gate).toEqual(gate);
    expect(result.governance?.evidence).toEqual(evidence);
  });

  it('preserves prior governance set by an earlier adapter (no clobber)', async () => {
    const prior: GovernanceContext = {
      contract_id: 'c-9',
      validated: true,
      l1_pass: true,
      l2_pass: true,
      l3_pass: true,
      violations: ['none'],
      circuit_state: 'closed',
      tier: 'L0+L1',
    };
    const adapter = new AegisAdapter({ getGovernance: () => ({ approval_gate: gate }) });
    const result = await adapter.contribute({ governance: prior });
    // Aegis overlays approval_gate but keeps everything Lattice set.
    expect(result.governance?.contract_id).toBe('c-9');
    expect(result.governance?.validated).toBe(true);
    expect(result.governance?.tier).toBe('L0+L1');
    expect(result.governance?.approval_gate).toEqual(gate);
  });

  it('composes after LatticeAdapter in a contribute chain', async () => {
    const lattice = new LatticeAdapter({ getContract: () => mockContract });
    const aegis = new AegisAdapter({ getGovernance: () => ({ approval_gate: gate, evidence }) });

    const afterLattice = await lattice.contribute({ payload: null });
    const afterAegis = await aegis.contribute(afterLattice);

    expect(afterAegis.governance?.contract_id).toBe('contract-123');
    expect(afterAegis.governance?.approval_gate).toEqual(gate);
    expect(afterAegis.governance?.evidence).toEqual(evidence);
  });

  it('observe is a no-op', async () => {
    const adapter = new AegisAdapter({ getGovernance: () => null });
    await expect(adapter.observe({} as never)).resolves.toBeUndefined();
  });
});
