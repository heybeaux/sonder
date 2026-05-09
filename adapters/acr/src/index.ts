import type { SonderAdapter, SonderEvent } from '@sonder/core';

export class AcrAdapter implements SonderAdapter {
  readonly name = 'acr';
  readonly version = '0.1.0';

  async contribute(event: Partial<SonderEvent>): Promise<Partial<SonderEvent>> {
    // TODO: implement acr contribution
    return event;
  }

  async observe(_event: SonderEvent): Promise<void> {
    // TODO: implement acr observation
  }
}
