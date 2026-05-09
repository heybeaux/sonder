import type { SonderAdapter, SonderEvent } from '@sonder/core';

export class LewmAdapter implements SonderAdapter {
  readonly name = 'lewm';
  readonly version = '0.1.0';

  async contribute(event: Partial<SonderEvent>): Promise<Partial<SonderEvent>> {
    // TODO: implement lewm contribution
    return event;
  }

  async observe(_event: SonderEvent): Promise<void> {
    // TODO: implement lewm observation
  }
}
