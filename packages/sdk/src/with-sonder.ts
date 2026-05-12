import type { SonderEventAny } from '@heybeaux/sonder-core';
import type { SonderRuntime } from './runtime.js';

export interface WithSonderOptions {
  /**
   * Sonder runtime — must be created via `createRuntime()`. v0.2 routes
   * through `runtime.emit` (the v2 chain pipeline). The previous shape
   * `{ bus }` is no longer supported.
   */
  runtime: SonderRuntime;
  /** agent_id to stamp on every emitted event */
  agentId: string;
  /** task_id to stamp on every emitted event */
  taskId: string;
  /** Optional parent event ID for causal chaining */
  parentId?: string;
  /**
   * Called after each event is emitted — useful for logging or side effects.
   */
  onEvent?: (event: SonderEventAny) => void;
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
 *   const runtime = createRuntime();
 *   const draft = withSonder(myDraftFn, {
 *     runtime,
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
    const { runtime, agentId, taskId, parentId, onEvent } = options;

    // Emit 'before' event — cognitive context at decision time
    const beforeEvent = await runtime.emit({
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
      const failEvent = await runtime.emit({
        agent_id: agentId,
        task_id: taskId,
        parent_id: beforeEvent.id,
        payload: { phase: 'error', input, error: String(err) },
      });
      onEvent?.(failEvent);
      throw err;
    }

    // Emit 'after' event — carries the output as payload
    const afterEvent = await runtime.emit({
      agent_id: agentId,
      task_id: taskId,
      parent_id: beforeEvent.id,
      payload: { phase: 'after', input, output },
    });
    onEvent?.(afterEvent);

    return output;
  };
}
