import { describe, it, expect } from 'vitest';
import { LatticeAdapter } from '../index.js';
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
