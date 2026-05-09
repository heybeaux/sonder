import { SonderBus, type SonderBusOptions, type SonderAdapter } from '@sonder/core';

export interface RuntimeConfig extends SonderBusOptions {
  /** Adapters to register on the bus. Order determines contribute() call order. */
  adapters?: SonderAdapter[];
}

export interface SonderRuntime {
  bus: SonderBus;
  /** Shut down the runtime and close the audit log. */
  shutdown(): void;
}

/**
 * createRuntime() — factory that wires adapters onto a configured SonderBus.
 *
 * Usage:
 *   const runtime = createRuntime({
 *     adapters: [new LatticeAdapter(...), new EngramAdapter(...)],
 *     dbPath: './audit.db',
 *   });
 *   await runtime.bus.emit({ agent_id, task_id, payload });
 *   runtime.shutdown();
 */
export function createRuntime(config: RuntimeConfig = {}): SonderRuntime {
  const busOptions: SonderBusOptions = {};
  if (config.dbPath !== undefined) busOptions.dbPath = config.dbPath;
  const bus = new SonderBus(busOptions);

  for (const adapter of config.adapters ?? []) {
    bus.register(adapter);
  }

  return {
    bus,
    shutdown() {
      bus.close();
    },
  };
}
