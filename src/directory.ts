import type { Store } from './store.js';
import type { DayState } from './types.js';

// Telegram only hands out usernames as part of an update, so `/admin say @name` can address
// nobody the bot has never seen. The index is a convenience, never an authorisation: group
// membership is still checked against Telegram before anything is sent.
type Entry = { id: number; at: string };
const key = (username: string) => `username:${username.toLowerCase()}`;
// The handle a person was last seen under. A username can be given up and taken over by
// somebody else, so the handle they have now is what decides who answers to the old one.
const handleKey = (userId: number) => `handle:${userId}`;

export function rememberUsername(store: Store, userId: number, username: string | undefined, now: Date): void {
  if (!username) return;
  const handle = username.toLowerCase();
  const previous = store.get<string | null>(handleKey(userId));
  // Only give up the old handle if it still points here: somebody else may have taken it.
  if (previous && previous !== handle && store.get<Entry | null>(key(previous))?.id === userId) store.set(key(previous), null);
  store.set(handleKey(userId), handle);
  store.set(key(handle), { id: userId, at: now.toISOString() } satisfies Entry);
}

// Sign-up records are the fallback: they carry usernames of people who pressed a button in the
// group long before the index existed. The newest day wins, and anybody known to have renamed
// since is skipped.
export function findByUsername(store: Store, username: string): number | undefined {
  const wanted = username.replace(/^@/, '').toLowerCase();
  const indexed = store.get<Entry | null>(key(wanted))?.id;
  if (indexed !== undefined) return indexed;
  for (const day of store.list<DayState>('day:').reverse()) {
    for (const entry of Object.values(day.signup?.choices ?? {})) {
      if (entry.user.username?.toLowerCase() !== wanted) continue;
      const handle = store.get<string | null>(handleKey(entry.user.id));
      if (!handle || handle === wanted) return entry.user.id;
    }
  }
  return undefined;
}
