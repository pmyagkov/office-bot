import { afterEach, expect, it, vi } from 'vitest';
import { openStore } from '../src/store.js';
import { createDelivery } from '../src/delivery.js';
const stores: ReturnType<typeof openStore>[] = [];
afterEach(() => stores.splice(0).forEach(s => s.close()));
function setup() { const store = openStore(':memory:'); stores.push(store); return { store, delivery: createDelivery(store) }; }
const now = new Date('2026-09-30T07:00:00Z');
it('reuses a confirmed result without sending twice', async () => {
  const { delivery } = setup();
  const action = vi.fn(async () => ({ kind: 'sent' as const, value: 42 }));
  expect(await delivery.deliver('assignment:day', now, action)).toEqual({ kind: 'sent', value: 42 });
  expect(await delivery.deliver('assignment:day', now, action)).toEqual({ kind: 'sent', value: 42 });
  expect(action).toHaveBeenCalledTimes(1);
});
it('preserves uncertain sends across restarts and redacts network errors', async () => {
  const { store, delivery } = setup();
  await expect(delivery.deliver('one', now, async () => { throw Error('https://api.telegram.org/botSECRET/sendMessage'); })).resolves.toEqual({ kind: 'uncertain' });
  const action = vi.fn();
  expect(await createDelivery(store).deliver('one', now, action)).toEqual({ kind: 'uncertain' });
  expect(action).not.toHaveBeenCalled();
  expect(JSON.stringify(store.list('op:'))).not.toContain('SECRET');
});
it('recovers a crash between sending and persisting the response conservatively', async () => {
  const { store } = setup();
  store.set('op:one', { key: 'one', status: 'sending', updatedAt: now.toISOString() });
  const action = vi.fn();
  expect(await createDelivery(store).deliver('one', now, action)).toEqual({ kind: 'uncertain' });
  expect(action).not.toHaveBeenCalled();
});
it('retries only a known 429 rejection after its persisted retry time', async () => {
  const { store, delivery } = setup();
  const action = vi.fn().mockResolvedValueOnce({ kind: 'rejected', code: 429, retryAfter: 60 }).mockResolvedValue({ kind: 'sent', value: 20 });
  await delivery.deliver('one', now, action);
  await createDelivery(store).deliver('one', new Date(now.getTime() + 30_000), action);
  expect(action).toHaveBeenCalledTimes(1);
  expect(await createDelivery(store).deliver('one', new Date(now.getTime() + 60_000), action)).toEqual({ kind: 'sent', value: 20 });
});
it('retains forbidden delivery for operator inspection', async () => {
  const { delivery, store } = setup();
  const action = vi.fn(async () => ({ kind: 'rejected' as const, code: 403 }));
  await delivery.deliver('dm', now, action); await delivery.deliver('dm', now, action);
  expect(action).toHaveBeenCalledTimes(1);
  expect(store.get('op:dm')).toMatchObject({ status: 'rejected', code: 403 });
});
