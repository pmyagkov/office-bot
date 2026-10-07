import type { Store } from './store.js';
import type { DayState } from './types.js';

// Telegram only hands out usernames as part of an update, so `/admin say @name` can address
// nobody the bot has never seen. The index is a convenience, never an authorisation: group
// membership is still checked against Telegram before anything is sent.
type Entry = { id: number; at: string };
const key = (username: string) => `username:${username.toLowerCase()}`;

export function rememberUsername(store: Store, userId: number, username: string | undefined, now: Date): void {
  if (!username) return;
  store.set(key(username), { id: userId, at: now.toISOString() } satisfies Entry);
}

// Sign-up records are the fallback: they carry usernames of people who pressed a button in the
// group long before the index existed.
export function findByUsername(store: Store, username: string): number | undefined {
  const wanted = username.replace(/^@/, '').toLowerCase();
  const indexed = store.get<Entry | null>(key(wanted))?.id;
  if (indexed !== undefined) return indexed;
  for (const day of store.list<DayState>('day:')) {
    for (const entry of Object.values(day.signup?.choices ?? {})) {
      if (entry.user.username?.toLowerCase() === wanted) return entry.user.id;
    }
  }
  return undefined;
}
