import { monotonicFactory } from 'ulidx';

const ulid = monotonicFactory();

export function createEventId(): string {
  return ulid();
}
