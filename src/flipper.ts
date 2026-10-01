import type { Store } from './store.js';

const MAX_NAME_LENGTH = 64;
type FlipperRecord = { name: string; setBy: number; at: string };

export function validateFlipperName(raw: string): string | null {
  const name = raw.trim();
  const length = [...name].length;
  if (length < 1 || length > MAX_NAME_LENGTH || /\p{Cc}/u.test(name)) return null;
  return name;
}

export function getFlipperName(store: Store, userId: number): string | undefined {
  return store.get<FlipperRecord>(`flipper:${userId}`)?.name;
}

export function setFlipperName(store: Store, userId: number, name: string, setBy: number, now: Date): void {
  store.set(`flipper:${userId}`, { name, setBy, at: now.toISOString() } satisfies FlipperRecord);
}
