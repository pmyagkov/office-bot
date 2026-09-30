import { afterEach, expect, it } from 'vitest';
import { harness, at } from './helpers/harness.js';
import { createScheduler } from '../src/scheduler.js';
import { createDelivery } from '../src/delivery.js';
import { schedule } from './helpers/harness.js';
import { groupId } from './fixtures/telegram-updates.js';
const instances: ReturnType<typeof harness>[] = [];
afterEach(() => instances.splice(0).forEach(h => h.store.close()));
async function setup() { const h = harness(); instances.push(h); await h.scheduler.tick(at('09:00')); h.vote('helper', 11); h.vote('request', 22); await h.close(); return h; }
it('sends one private reminder at fourteen, retaining that fact after restart', async () => {
  const h = await setup(); await h.scheduler.tick(at('13:59')); expect(h.calls('sendMessage')).toHaveLength(1);
  await h.scheduler.tick(at('14:00')); await h.scheduler.tick(at('14:01'));
  const restarted = createScheduler({ ...h, delivery: createDelivery(h.store), schedule, chatId: groupId, chooseIndex: () => 0 });
  await restarted.tick(at('15:00')); expect(h.calls('sendMessage')).toHaveLength(2);
  expect(h.calls('sendMessage')[1].payload).toMatchObject({ chat_id: 11 });
  expect(h.calls('sendMessage')[1].payload.text).toContain('https://t.me/c/1234567890/3');
});
it('sends a missed reminder later on the same day', async () => { const h = await setup(); await h.scheduler.tick(at('15:00')); expect(h.calls('sendMessage')).toHaveLength(2); });
it('never reminds about yesterday', async () => { const h = await setup(); await h.scheduler.tick(at('15:00', '2026-10-01')); expect(h.calls('sendMessage')).toHaveLength(1); });
it('suppresses reminders after confirmation', async () => {
  const h = await setup(); await h.updates.handleUpdate(h.event.click('2026-09-30', 11, 3), at('13:59')); await h.scheduler.tick(at('14:00')); expect(h.calls('sendMessage')).toHaveLength(1);
});
it('records a blocked private chat without a group fallback', async () => {
  const h = await setup(); h.mock.failures.set('sendMessage', { code: 403 }); await h.scheduler.tick(at('14:00')); await h.scheduler.tick(at('14:10'));
  expect(h.calls('sendMessage')).toHaveLength(2); expect(h.store.get('op:reminder:2026-09-30')).toMatchObject({ status: 'rejected', code: 403 });
  h.mock.failures.clear(); await h.updates.handleUpdate(h.event.command('/today'), at('14:11'));
  expect(h.calls('sendMessage').at(-1)?.payload.text).toContain('403');
});
