import { ulid } from 'ulidx';

export function createEventId(): string {
  return ulid();
}
