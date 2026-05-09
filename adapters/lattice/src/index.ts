import type { SonderAdapter, SonderEvent } from '@sonder/core';

export class LatticeAdapter implements SonderAdapter {
  readonly name = 'lattice';
  readonly version = '0.1.0';

  async contribute(event: Partial<SonderEvent>): Promise<Partial<SonderEvent>> {
    // TODO: implement lattice contribution
    return event;
  }

  async observe(_event: SonderEvent): Promise<void> {
    // TODO: implement lattice observation
  }
}
