import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openStore(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new Database(path);
  db.pragma('busy_timeout = 5000');
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version > 1) { db.close(); throw new Error('Database was created by a newer version'); }
  db.transaction(() => {
    db.exec('CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL CHECK(json_valid(value)))');
    db.pragma('user_version = 1');
  })();
  const read = db.prepare('SELECT value FROM state WHERE key = ?');
  const write = db.prepare('INSERT INTO state VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const scan = db.prepare('SELECT value FROM state WHERE substr(key, 1, length(?)) = ? ORDER BY key');
  return {
    get<T>(key: string): T | undefined {
      const row = read.get(key) as { value: string } | undefined;
      return row ? JSON.parse(row.value) as T : undefined;
    },
    set<T>(key: string, value: T): void { write.run(key, JSON.stringify(value)); },
    list<T>(prefix: string): T[] {
      return (scan.all(prefix, prefix) as {value: string}[]).map(row => JSON.parse(row.value) as T);
    },
    atomic<T>(fn: () => T): T { return db.transaction(fn)(); },
    async backup(destination: string): Promise<void> { await db.backup(destination); },
    close(): void { db.close(); },
  };
}
export type Store = ReturnType<typeof openStore>;

export function scopedStore(parent: Store, prefix: string): Store {
  return { ...parent,
    get: key => parent.get(`${prefix}${key}`),
    set: (key, value) => parent.set(`${prefix}${key}`, value),
    list: key => parent.list(`${prefix}${key}`),
  };
}
