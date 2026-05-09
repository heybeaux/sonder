import type { SonderEvent, EventFilter, GovernanceContext, MemoryContext, ReasoningContext, CapabilityContext, PredictionContext, IntentContext } from './types/event.js';
import type { SonderAdapter } from './types/adapter.js';
import { createEventId } from './ulid.js';
import { AuditLog } from './audit.js';

const DEFAULTS: Pick<SonderEvent, 'capabilities' | 'memory' | 'reasoning' | 'governance' | 'prediction' | 'intent'> = {
  capabilities: { mounted: [], resolution: {}, budget_used: 0, budget_limit: 0 } satisfies CapabilityContext,
  memory:       { refs: [], confidence: 0 } satisfies MemoryContext,
  reasoning:    { model: '', neurotypes: [], consensus: false, dissent: [], osi: 0, rounds: 0 } satisfies ReasoningContext,
  governance:   { contract_id: '', validated: false, l1_pass: false, l2_pass: false, l3_pass: false, violations: [], circuit_state: 'closed' } satisfies GovernanceContext,
  prediction:   { outcome: '', confidence: 0, alpha: 1, beta: 1, model_id: '' } satisfies PredictionContext,
  intent:       { action: '', step_trace_id: '', skipped: false, constraint_injected: false } satisfies IntentContext,
};

type EventHandler = (event: SonderEvent) => void;

export interface SonderBusOptions {
  dbPath?: string;
}

export class SonderBus {
  private adapters: SonderAdapter[] = [];
  private handlers = new Map<string, Set<EventHandler>>();
  private anyHandlers = new Set<EventHandler>();
  private audit: AuditLog;

  constructor(options: SonderBusOptions = {}) {
    this.audit = new AuditLog(options.dbPath);
  }

  register(adapter: SonderAdapter): void {
    this.adapters.push(adapter);
  }

  on(type: string, handler: EventHandler): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
    return () => this.handlers.get(type)?.delete(handler);
  }

  onAny(handler: EventHandler): () => void {
    this.anyHandlers.add(handler);
    return () => this.anyHandlers.delete(handler);
  }

  async emit(
    base: Pick<SonderEvent, 'agent_id' | 'task_id' | 'payload'> &
      Partial<Omit<SonderEvent, 'id' | 'version' | 'timestamp'>>,
  ): Promise<SonderEvent> {
    let partial: Partial<SonderEvent> = {
      ...DEFAULTS,
      ...base,
      id: createEventId(),
      version: '1',
      timestamp: new Date().toISOString(),
    };

    // Synchronous contribute phase — all adapters run in parallel
    const contributions = await Promise.all(
      this.adapters.map((a) => a.contribute(partial)),
    );
    for (const contribution of contributions) {
      partial = { ...partial, ...contribution };
    }

    const event = partial as SonderEvent;

    // Persist before notifying observers
    this.audit.write(event);

    // Notify typed handlers
    const typed = this.handlers.get(event.intent?.action ?? '');
    if (typed) {
      for (const h of typed) h(event);
    }
    for (const h of this.anyHandlers) h(event);

    // Async observe phase — fire and forget
    void Promise.all(this.adapters.map((a) => a.observe(event)));

    return event;
  }

  query(filter: EventFilter): SonderEvent[] {
    return this.audit.query(filter);
  }

  close(): void {
    this.audit.close();
  }
}
