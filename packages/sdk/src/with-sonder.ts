import type { SonderBus, SonderEvent } from '@heybeaux/sonder-core';

export interface WithSonderOptions {
  bus: SonderBus;
  /** agent_id to stamp on every emitted event */
  agentId: string;
  /** task_id to stamp on every emitted event */
  taskId: string;
  /** Optional parent event ID for causal chaining */
  parentId?: string;
  /** Called after each event is emitted — useful for logging or side effects */
  onEvent?: (event: SonderEvent) => void;
}

export type WrappedAgentFn<TInput, TOutput> = (input: TInput) => Promise<TOutput>;

/**
 * withSonder() — HOC that wraps any async agent function with automatic
 * SonderEvent emission before and after execution.
 *
 * Emits two events per invocation:
 *   - 'before' event: captures cognitive context at decision time (intent)
 *   - 'after' event:  captures the outcome with the function's output as payload
 *
 * Usage:
 *   const draft = withSonder(myDraftFn, {
 *     bus: runtime.bus,
 *     agentId: 'agent:draft',
 *     taskId: 'task:linkedin-post',
 *   });
 *   const result = await draft({ topic: 'Sonder release' });
 */
export function withSonder<TInput, TOutput>(
  fn: WrappedAgentFn<TInput, TOutput>,
  options: WithSonderOptions,
): WrappedAgentFn<TInput, TOutput> {
  return async (input: TInput): Promise<TOutput> => {
    const { bus, agentId, taskId, parentId, onEvent } = options;

    // Emit 'before' event — cognitive context at decision time
    const beforeEvent = await bus.emit({
      agent_id: agentId,
      task_id: taskId,
      ...(parentId !== undefined && { parent_id: parentId }),
      payload: { phase: 'before', input },
    });
    onEvent?.(beforeEvent);

    let output: TOutput;
    try {
      output = await fn(input);
    } catch (err) {
      // Emit failure event so the audit log captures the crash
      const failEvent = await bus.emit({
        agent_id: agentId,
        task_id: taskId,
        parent_id: beforeEvent.id,
        payload: { phase: 'error', input, error: String(err) },
      });
      onEvent?.(failEvent);
      throw err;
    }

    // Emit 'after' event — carries the output as payload
    const afterEvent = await bus.emit({
      agent_id: agentId,
      task_id: taskId,
      parent_id: beforeEvent.id,
      payload: { phase: 'after', input, output },
    });
    onEvent?.(afterEvent);

    return output;
  };
}
