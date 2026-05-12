import { describe, it, expect, vi } from 'vitest';
import { createRuntime } from '../runtime.js';
import { withSonder } from '../with-sonder.js';

describe('withSonder', () => {
  it('calls the wrapped function and returns its output', async () => {
    const runtime = createRuntime();
    const fn = vi.fn(async (x: number) => x * 2);
    const wrapped = withSonder(fn, { bus: runtime.bus, agentId: 'a', taskId: 't' });

    const result = await wrapped(5);
    expect(result).toBe(10);
    expect(fn).toHaveBeenCalledWith(5);
    runtime.shutdown();
  });

  it('emits before and after events', async () => {
    const runtime = createRuntime();
    const events: string[] = [];

    const wrapped = withSonder(async (x: number) => x + 1, {
      bus: runtime.bus,
      agentId: 'agent-x',
      taskId: 'task-y',
      onEvent: (e) => events.push((e.payload as { phase: string }).phase),
    });

    await wrapped(1);
    expect(events).toEqual(['before', 'after']);
    runtime.shutdown();
  });

  it('after event has before event as parent_id', async () => {
    const runtime = createRuntime();
    const emitted: import('@heybeaux/sonder-core').SonderEvent[] = [];

    const wrapped = withSonder(async () => 'done', {
      bus: runtime.bus,
      agentId: 'a',
      taskId: 't',
      onEvent: (e) => emitted.push(e),
    });

    await wrapped(undefined);
    expect(emitted[1]?.parent_id).toBe(emitted[0]?.id);
    runtime.shutdown();
  });

  it('emits error event and rethrows on failure', async () => {
    const runtime = createRuntime();
    const events: string[] = [];

    const wrapped = withSonder(async () => { throw new Error('boom'); }, {
      bus: runtime.bus,
      agentId: 'a',
      taskId: 't',
      onEvent: (e) => events.push((e.payload as { phase: string }).phase),
    });

    await expect(wrapped(null)).rejects.toThrow('boom');
    expect(events).toContain('before');
    expect(events).toContain('error');
    expect(events).not.toContain('after');
    runtime.shutdown();
  });

  it('stamps agent_id and task_id on every event', async () => {
    const runtime = createRuntime();
    const emitted: import('@heybeaux/sonder-core').SonderEvent[] = [];

    const wrapped = withSonder(async () => null, {
      bus: runtime.bus,
      agentId: 'my-agent',
      taskId: 'my-task',
      onEvent: (e) => emitted.push(e),
    });

    await wrapped(null);
    for (const e of emitted) {
      expect(e.agent_id).toBe('my-agent');
      expect(e.task_id).toBe('my-task');
    }
    runtime.shutdown();
  });

  it('uses provided parentId on before event', async () => {
    const runtime = createRuntime();
    const emitted: import('@heybeaux/sonder-core').SonderEvent[] = [];

    const wrapped = withSonder(async () => null, {
      bus: runtime.bus,
      agentId: 'a',
      taskId: 't',
      parentId: 'upstream-event-id',
      onEvent: (e) => emitted.push(e),
    });

    await wrapped(null);
    expect(emitted[0]?.parent_id).toBe('upstream-event-id');
    runtime.shutdown();
  });
});
