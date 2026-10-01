import { afterEach, expect, it, vi } from 'vitest';
import { harness, at } from './helpers/harness.js';
const instances: ReturnType<typeof harness>[] = [];
afterEach(() => instances.splice(0).forEach(h => h.store.close()));
async function setup() { const h = harness(); instances.push(h); await h.scheduler.tick(at('09:00')); h.vote('helper', 11); h.vote('request', 22); await h.close(); return h; }
// The sign-up message (id 1) is edited at closing; only edits of the assignment message (id 2) matter here.
const edits = (h: ReturnType<typeof harness>) => h.calls('editMessageText').filter(c => c.payload.message_id === 2);
it('records the assigned helper once and removes the button', async () => {
  const h = await setup(); const click = h.event.click('2026-09-30', 11, h.day().assignment!.messageId!);
  await h.updates.handleUpdate(click, at('10:24')); await h.updates.handleUpdate(click, at('10:25')); await h.scheduler.tick(at('10:26'));
  expect(h.day().assignment?.confirmedAt).toBe(at('10:24').toISOString());
  expect(edits(h)).toHaveLength(1);
  expect(edits(h)[0].payload).toMatchObject({ reply_markup: { inline_keyboard: [] } });
  expect(edits(h)[0].payload.text).toContain('badge duty today'); expect(edits(h)[0].payload.text).toContain('✅ Confirmed 10:24');
  expect(edits(h)[0].payload.text).not.toContain('30 Sept 2026, 10:24');
});
it('the confirmed message keeps the recipient list and the helper tag', async () => {
  const h = await setup(); const original = String(h.calls('sendMessage')[1].payload.text);
  await h.updates.handleUpdate(h.event.click('2026-09-30', 11, 2), at('10:24'));
  const text = String(edits(h)[0].payload.text);
  expect(text).toBe(`${original}\n\n✅ Confirmed 10:24`);
  expect(text).toContain('<a href="tg://user?id=11">'); expect(text).toContain('• F22');
});
it.each(['actor', 'chat', 'message', 'day', 'malformed'])('rejects the wrong %s without counting completion', async wrong => {
  const h = await setup();
  const click = h.event.click(wrong === 'day' ? '2026-09-29' : wrong === 'malformed' ? '../../bad' : '2026-09-30', wrong === 'actor' ? 22 : 11, wrong === 'message' ? 999 : h.day().assignment!.messageId!, wrong === 'chat' ? -100999 : undefined);
  await h.updates.handleUpdate(click, at('11:00'));
  expect(h.day().assignment?.confirmedAt).toBeNull(); expect(edits(h)).toHaveLength(0);
});
it('commits confirmation before an edit failure and retries only the edit', async () => {
  const h = await setup(); h.mock.failures.set('editMessageText', { code: 500 });
  const log = vi.spyOn(console, 'error').mockImplementation(() => {}); let logged: unknown[][];
  try { await h.updates.handleUpdate(h.event.click('2026-09-30', 11, h.day().assignment!.messageId!), at('10:24')); }
  finally { logged = [...log.mock.calls]; log.mockRestore(); }
  expect(logged).toEqual([[JSON.stringify({ event: 'assignment_edit_failed', day: '2026-09-30' })]]);
  expect(h.day().assignment?.confirmedAt).toBe(at('10:24').toISOString()); expect(h.day().assignment?.rendered).toBe(false);
  h.mock.failures.clear(); await h.scheduler.tick(at('10:25')); expect(h.day().assignment?.rendered).toBe(true);
  await h.updates.handleUpdate(h.event.click('2026-09-30', 11, h.day().assignment!.messageId!), at('10:26'));
  expect(h.day().assignment?.confirmedAt).toBe(at('10:24').toISOString()); expect(h.calls('answerCallbackQuery').at(-1)?.payload.text).toContain('already');
});
