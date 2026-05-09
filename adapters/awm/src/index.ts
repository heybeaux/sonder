import type { SonderAdapter, SonderEvent } from '@sonder/core';

export class AwmAdapter implements SonderAdapter {
  readonly name = 'awm';
  readonly version = '0.1.0';

  async contribute(event: Partial<SonderEvent>): Promise<Partial<SonderEvent>> {
    // TODO: implement awm contribution
    return event;
  }

  async observe(_event: SonderEvent): Promise<void> {
    // TODO: implement awm observation
  }
}
