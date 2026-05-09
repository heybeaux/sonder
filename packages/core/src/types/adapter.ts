import type { SonderEvent } from './event.js';

export interface SonderAdapter {
  name: string;
  version: string;
  contribute(event: Partial<SonderEvent>): Promise<Partial<SonderEvent>>;
  observe(event: SonderEvent): Promise<void>;
}
