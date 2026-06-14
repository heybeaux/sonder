import type {
  SonderEvent,
  SonderEventV1,
  SonderEventV2,
  SonderEventCore,
  EventFilter,
  GovernanceContext,
  MemoryContext,
  ReasoningContext,
  CapabilityContext,
  PredictionContext,
  IntentContext,
} from './types/event.js';
import type { SonderAdapter } from './types/adapter.js';
import { createEventId } from './ulid.js';
import { AuditLog } from './audit.js';
import { GatePendingError, findPendingGate } from './gate.js';

const DEFAULTS: Pick<SonderEventCore,
  'capabilities' | 'memory' | 'reasoning' | 'governance' | 'prediction' | 'intent'
> = {
  capabilities: { mounted: [], resolution: {}, budget_used: 0, budget_limit: 0 } satisfies CapabilityContext,
  memory:       { refs: [], confidence: 0 } satisfies MemoryContext,
  reasoning:    { model: '', neurotypes: [], consensus: false, dissent: [], osi: 0, rounds: 0 } satisfies ReasoningContext,
  governance:   { contract_id: '', validated: false, l1_pass: false, l2_pass: false, l3_pass: false, violations: [], circuit_state: 'closed' } satisfies GovernanceContext,
  prediction:   { outcome: '', confidence: 0, alpha: 1, beta: 1, model_id: '' } satisfies PredictionContext,
  intent:       { action: '', step_trace_id: '', skipped: false, constraint_injected: false } satisfies IntentContext,
};

type EventHandler = (event: SonderEvent) => void;
type LegacyEventHandler = (event: SonderEventV1) => void;

export interface SonderBusOptions {
  dbPath?: string;
}

/**
 * SonderBus — the v0.1 entry point. Still emits v1 events. The v2 emit
 * pipeline (redact → enforce → validate-L0 → hash → sign → persist)
 * lives in a separate chain-pipeline module that wraps the bus.
 *
 * Adapter contributors operate on `SonderEventCore` so the bus stays
 * forward-compatible with v2 envelopes.
 */
export class SonderBus {
  private adapters: SonderAdapter[] = [];
  private handlers = new Map<string, Set<LegacyEventHandler | EventHandler>>();
  private anyHandlers = new Set<LegacyEventHandler | EventHandler>();
  audit: AuditLog;

  constructor(options: SonderBusOptions = {}) {
    this.audit = new AuditLog(options.dbPath);
  }

  register(adapter: SonderAdapter): void {
    this.adapters.push(adapter);
  }

  /** Read-only snapshot of registered adapters (used by the emit pipeline's gate check). */
  getAdapters(): readonly SonderAdapter[] {
    return this.adapters;
  }

  on(type: string, handler: EventHandler | LegacyEventHandler): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
    return () => this.handlers.get(type)?.delete(handler);
  }

  onAny(handler: EventHandler | LegacyEventHandler): () => void {
    this.anyHandlers.add(handler);
    return () => this.anyHandlers.delete(handler);
  }

  /**
   * Build a v1 envelope by running all adapter contributors. Pure-ish:
   * the resulting object is suitable as input to the v2 chain pipeline.
   * Used internally by `emit` and exposed for the chain pipeline.
   */
  async buildEnvelope(
    base: Pick<SonderEventCore, 'agent_id' | 'task_id' | 'payload'> &
      Partial<Omit<SonderEventCore, 'id' | 'timestamp'>>,
  ): Promise<SonderEventV1> {
    let partial: Partial<SonderEventCore> & { version?: '1' } = {
      ...DEFAULTS,
      ...base,
      id: createEventId(),
      timestamp: new Date().toISOString(),
    };

    const snapshot = partial;
    const contributions = await Promise.all(
      this.adapters.map((a) => a.contribute(snapshot)),
    );
    for (const contribution of contributions) {
      const diff: Partial<SonderEventCore> = {};
      for (const key of Object.keys(contribution) as Array<keyof SonderEventCore>) {
        if (contribution[key] !== snapshot[key]) {
          (diff as Record<string, unknown>)[key] = contribution[key];
        }
      }
      partial = { ...partial, ...diff };
    }

    return { ...(partial as SonderEventCore), version: '1' };
  }

  async emit(
    base: Pick<SonderEventCore, 'agent_id' | 'task_id' | 'payload'> &
      Partial<Omit<SonderEventCore, 'id' | 'timestamp'>>,
  ): Promise<SonderEventV1> {
    const event = await this.buildEnvelope(base);

    // Spike A.5 — pre-emit gate veto. Runs after envelope build, before
    // persistence. Any adapter that returns a pending gate aborts the emit:
    // no audit row, no observers notified. The caller (typically wrapped
    // in `emitWithGateRetry`) catches GatePendingError and retries once
    // the gate has been resolved out-of-band.
    const pending = await findPendingGate(this.adapters, event);
    if (pending) throw new GatePendingError(pending.adapterName, pending.gate);

    // Persist before notifying observers
    this.audit.write(event);

    // Notify typed handlers
    const typed = this.handlers.get(event.intent?.action ?? '');
    if (typed) {
      for (const h of typed) (h as LegacyEventHandler)(event);
    }
    for (const h of this.anyHandlers) (h as LegacyEventHandler)(event);

    // Async observe phase — fire and forget. v1 events are passed through
    // to `observe(SonderEvent)` adapters as-is; the v2-only fields will be
    // absent and adapter implementations must guard on `event.version`.
    void Promise.all(this.adapters.map((a) => a.observe(event as unknown as SonderEvent)));
    /* eslint-disable-line @typescript-eslint/no-explicit-any */

    return event;
  }

  /**
   * Persist an already-signed v2 event from the chain pipeline. Called by
   * the v2 emit wrapper after redact/enforce/validate/hash/sign. The
   * caller is responsible for running this inside `audit.immediate()`.
   */
  persistSigned(event: SonderEventV2): void {
    this.audit.writeChain(event);
    const typed = this.handlers.get(event.intent?.action ?? '');
    if (typed) {
      for (const h of typed) (h as EventHandler)(event);
    }
    for (const h of this.anyHandlers) (h as EventHandler)(event);
    void Promise.all(this.adapters.map((a) => a.observe(event)));
  }

  query(filter: EventFilter) {
    return this.audit.query(filter);
  }

  close(): void {
    this.audit.close();
  }
}
