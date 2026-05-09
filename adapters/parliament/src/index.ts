import type { SonderAdapter, SonderEvent } from '@sonder/core';

export class ParliamentAdapter implements SonderAdapter {
  readonly name = 'parliament';
  readonly version = '0.1.0';

  async contribute(event: Partial<SonderEvent>): Promise<Partial<SonderEvent>> {
    // TODO: implement parliament contribution
    return event;
  }

  async observe(_event: SonderEvent): Promise<void> {
    // TODO: implement parliament observation
  }
}
