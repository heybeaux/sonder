import type { SonderEvent, SonderEventCore } from './event.js';

/**
 * Sonder adapter interface. Adapters contribute to the cognitive-context
 * surface (`SonderEventCore`) during the synchronous contribute phase, and
 * observe the fully-built event during the async observe phase.
 *
 * Adapters MUST NOT touch chain/signature fields — those are owned by
 * the runtime emit pipeline (Spec 2 R3/R4).
 */
export interface SonderAdapter {
  name: string;
  version: string;
  contribute(event: Partial<SonderEventCore>): Promise<Partial<SonderEventCore>>;
  observe(event: SonderEvent): Promise<void>;
}
