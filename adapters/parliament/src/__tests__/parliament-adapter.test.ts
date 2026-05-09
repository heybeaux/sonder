import { describe, it, expect } from 'vitest';
import { ParliamentAdapter } from '../index.js';

describe('ParliamentAdapter', () => {
  it('contributes empty reasoning when no deliberation has occurred', async () => {
    const adapter = new ParliamentAdapter({ getLastDeliberation: () => null });
    const result = await adapter.contribute({});
    expect(result.reasoning?.model).toBe('');
    expect(result.reasoning?.neurotypes).toEqual([]);
    expect(result.reasoning?.consensus).toBe(false);
    expect(result.reasoning?.rounds).toBe(0);
  });

  it('contributes model and neurotypes from deliberation', async () => {
    const adapter = new ParliamentAdapter({
      getLastDeliberation: () => ({
        model: 'claude-opus-4-7',
        neurotypes: ['empiricist', 'skeptic', 'synthesizer'],
        consensus: true,
        dissent: [],
        osi: 0.42,
        rounds: 3,
      }),
    });
    const result = await adapter.contribute({});
    expect(result.reasoning?.model).toBe('claude-opus-4-7');
    expect(result.reasoning?.neurotypes).toEqual(['empiricist', 'skeptic', 'synthesizer']);
    expect(result.reasoning?.rounds).toBe(3);
  });

  it('contributes dissent and osi correctly', async () => {
    const adapter = new ParliamentAdapter({
      getLastDeliberation: () => ({
        model: 'gpt-4o',
        neurotypes: ['empiricist', 'skeptic'],
        consensus: false,
        dissent: ['skeptic'],
        osi: 0.08,
        rounds: 5,
      }),
    });
    const result = await adapter.contribute({});
    expect(result.reasoning?.consensus).toBe(false);
    expect(result.reasoning?.dissent).toEqual(['skeptic']);
    expect(result.reasoning?.osi).toBe(0.08);
  });

  it('preserves other event fields', async () => {
    const adapter = new ParliamentAdapter({ getLastDeliberation: () => null });
    const result = await adapter.contribute({ agent_id: 'agent-abc' });
    expect(result.agent_id).toBe('agent-abc');
  });

  it('observe is a no-op', async () => {
    const adapter = new ParliamentAdapter({ getLastDeliberation: () => null });
    await expect(adapter.observe({} as never)).resolves.toBeUndefined();
  });
});
