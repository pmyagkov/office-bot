import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { openStore } from '../src/store.js';

describe('durable SQLite state', () => {
  it('persists frozen data and the cursor across reopening', () => {
    const dir = mkdtempSync(join(tmpdir(), 'office-store-'));
    const db = join(dir, 'test.db');
    let store = openStore(db);
    store.atomic(() => {
      store.set('day:2026-09-30', { helper: 11, recipients: [22, 33], confirmedAt: null });
      store.set('offset', 101);
    });
    store.close();
    store = openStore(db);
    expect(store.get('day:2026-09-30')).toEqual({ helper: 11, recipients: [22, 33], confirmedAt: null });
    expect(store.get('offset')).toBe(101);
    store.close();
    rmSync(dir, { recursive: true });
  });
  it('rolls state and cursor back together if processing fails', () => {
    const store = openStore(':memory:');
    expect(() => store.atomic(() => {
      store.set('offset', 20);
      store.set('day:2026-09-30', { confirmedAt: 'now' });
      throw new Error('crash');
    })).toThrow('crash');
    expect(store.get('offset')).toBeUndefined();
    expect(store.list('day:')).toEqual([]);
    store.close();
  });
  it('upserts one operation per key and makes consistent backups', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'office-backup-'));
    const store = openStore(join(dir, 'state.db'));
    store.set('op:confirm:one', { status: 'sending' });
    store.set('op:confirm:one', { status: 'sent' });
    await store.backup(join(dir, 'copy.db'));
    const copy = openStore(join(dir, 'copy.db'));
    expect(copy.list('op:')).toEqual([{ status: 'sent' }]);
    copy.close(); store.close(); rmSync(dir, { recursive: true });
  });
});
