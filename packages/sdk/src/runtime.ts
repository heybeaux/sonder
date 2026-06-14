import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  SonderBus,
  type SonderBusOptions,
  type SonderAdapter,
  type SonderEventV2,
  type SonderEventCore,
  type SensitivityLevel,
  loadOrGenerateKeypair,
  type LoadedKeypair,
} from '@heybeaux/sonder-core';
import { createEmitPipeline, type EmitPipeline } from './emit-pipeline.js';

export interface RuntimeRedactionConfig {
  sensitivityLevel?: SensitivityLevel;
  /**
   * Full replacement for the must-not-redact allowlist. MUST include
   * every default entry; omitting any throws at construction.
   */
  mustNotRedact?: readonly string[];
}

export interface RuntimeConfig extends SonderBusOptions {
  /** Adapters to register on the bus. Order determines contribute() call order. */
  adapters?: SonderAdapter[];
  /**
   * Override the default keypair file path. Falls back to env
   * `SONDER_KEY_PATH` then `~/.sonder/key`.
   */
  keyPath?: string;
  /** Redaction config (sensitivity, must-not-redact override). */
  redaction?: RuntimeRedactionConfig;
}

export interface SonderRuntime {
  bus: SonderBus;
  /** v2 emit pipeline — redact → enforce → validate-L0 → hash → sign → persist. */
  emit: EmitPipeline['emit'];
  /**
   * Phase 3.5 — emit a typed post-execution outcome event chained to a
   * decision event. Same signing pipeline as `emit`.
   */
  emitOutcome: EmitPipeline['emitOutcome'];
  /** Base64 ed25519 public key (Spec 2 R10). */
  publicKey: string;
  /** ISO8601 of keypair creation. */
  keyCreatedAt: string;
  /** Shut down the runtime and close the audit log. */
  shutdown(): void;
}

/** Resolve the keypair path: explicit > SONDER_KEY_PATH > ~/.sonder/key. */
function resolveKeyPath(explicit?: string): string {
  if (explicit) return explicit;
  if (process.env['SONDER_KEY_PATH']) return process.env['SONDER_KEY_PATH'];
  return join(homedir(), '.sonder', 'key');
}

/**
 * createRuntime() — factory that wires adapters onto a configured
 * SonderBus and constructs the v2 emit pipeline (Spec 2 Task 7).
 *
 * Usage:
 *   const runtime = createRuntime({
 *     adapters: [new LatticeAdapter(...), new EngramAdapter(...)],
 *     dbPath: './audit.db',
 *   });
 *   const event = await runtime.emit({ agent_id, task_id, payload });
 *   runtime.shutdown();
 */
export function createRuntime(config: RuntimeConfig = {}): SonderRuntime {
  const busOptions: SonderBusOptions = {};
  if (config.dbPath !== undefined) busOptions.dbPath = config.dbPath;
  const bus = new SonderBus(busOptions);

  for (const adapter of config.adapters ?? []) {
    bus.register(adapter);
  }

  const keypair: LoadedKeypair = loadOrGenerateKeypair(resolveKeyPath(config.keyPath));

  const pipelineConfig: Parameters<typeof createEmitPipeline>[0] = {
    bus,
    privateKey: keypair.privateKey,
    publicKeyBase64: keypair.publicKeyBase64,
  };
  if (config.redaction) {
    const r: NonNullable<typeof pipelineConfig['redaction']> = {};
    if (config.redaction.sensitivityLevel) r.sensitivityLevel = config.redaction.sensitivityLevel;
    if (config.redaction.mustNotRedact) r.mustNotRedact = config.redaction.mustNotRedact;
    pipelineConfig.redaction = r;
  }
  const pipeline = createEmitPipeline(pipelineConfig);

  return {
    bus,
    emit: pipeline.emit.bind(pipeline),
    emitOutcome: pipeline.emitOutcome.bind(pipeline),
    publicKey: keypair.publicKeyBase64,
    keyCreatedAt: keypair.createdAt,
    shutdown() {
      bus.close();
    },
  };
}

export type { SonderEventV2, SonderEventCore };
