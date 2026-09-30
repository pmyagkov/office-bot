import { afterEach, expect, it } from 'vitest';
import { harness, at } from './helpers/harness.js';
const instances: ReturnType<typeof harness>[] = [];
afterEach(() => instances.splice(0).forEach(h => h.store.close()));
async function setup() { const h = harness(); instances.push(h); await h.scheduler.tick(at('09:00')); h.vote('helper', 11); h.vote('request', 22); await h.close(); return h; }
it('records the assigned helper once and removes the button', async () => {
  const h = await setup(); const click = h.event.click('2026-09-30', 11, h.day().assignment!.messageId!);
  await h.updates.handleUpdate(click, at('10:24')); await h.updates.handleUpdate(click, at('10:25')); await h.scheduler.tick(at('10:26'));
  expect(h.day().assignment?.confirmedAt).toBe(at('10:24').toISOString());
  expect(h.calls('editMessageText')).toHaveLength(1);
  expect(h.calls('editMessageText')[0].payload).toMatchObject({ reply_markup: { inline_keyboard: [] } });
  expect(h.calls('editMessageText')[0].payload.text).toContain('30 Sept 2026, 10:24');
});
it.each(['actor', 'chat', 'message', 'day', 'malformed'])('rejects the wrong %s without counting completion', async wrong => {
  const h = await setup();
  const click = h.event.click(wrong === 'day' ? '2026-09-29' : wrong === 'malformed' ? '../../bad' : '2026-09-30', wrong === 'actor' ? 22 : 11, wrong === 'message' ? 999 : h.day().assignment!.messageId!, wrong === 'chat' ? -100999 : undefined);
  await h.updates.handleUpdate(click, at('11:00'));
  expect(h.day().assignment?.confirmedAt).toBeNull(); expect(h.calls('editMessageText')).toHaveLength(0);
});
it('commits confirmation before an edit failure and retries only the edit', async () => {
  const h = await setup(); h.mock.failures.set('editMessageText', { code: 500 });
  await h.updates.handleUpdate(h.event.click('2026-09-30', 11, h.day().assignment!.messageId!), at('10:24'));
  expect(h.day().assignment?.confirmedAt).toBe(at('10:24').toISOString()); expect(h.day().assignment?.rendered).toBe(false);
  h.mock.failures.clear(); await h.scheduler.tick(at('10:25')); expect(h.day().assignment?.rendered).toBe(true);
  await h.updates.handleUpdate(h.event.click('2026-09-30', 11, h.day().assignment!.messageId!), at('10:26'));
  expect(h.day().assignment?.confirmedAt).toBe(at('10:24').toISOString()); expect(h.calls('answerCallbackQuery').at(-1)?.payload.text).toContain('already');
});
