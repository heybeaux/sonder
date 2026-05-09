import type { SonderAdapter, SonderEvent } from '@sonder/core';

export class EngramAdapter implements SonderAdapter {
  readonly name = 'engram';
  readonly version = '0.1.0';

  async contribute(event: Partial<SonderEvent>): Promise<Partial<SonderEvent>> {
    // TODO: implement engram contribution
    return event;
  }

  async observe(_event: SonderEvent): Promise<void> {
    // TODO: implement engram observation
  }
}
