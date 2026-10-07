import { expect, it } from 'vitest';
import type { InlineKeyboardMarkup, Update } from 'grammy/types';
import { createRuntime } from '../src/runtime.js';
import { at, harness, schedule } from './helpers/harness.js';
import { groupId } from './fixtures/telegram-updates.js';

const now = at('23:30', '2026-09-29');
const sent = (h: ReturnType<typeof harness>) => h.calls('sendMessage').map(c => ({ chat: c.payload.chat_id, text: c.payload.text, markup: c.payload.reply_markup }));
const last = (h: ReturnType<typeof harness>) => sent(h).at(-1);
const INTRO = "Plan your next sign-up. I apply it the moment the sign-up opens, so a plan made tonight lands on tomorrow morning's sign-up.";
const KEYBOARD = { inline_keyboard: [
  [{ text: '🙋 Check me in', callback_data: 'plan:checkin' }, { text: '🛡 On duty', callback_data: 'plan:duty' }],
  [{ text: '❌ Clear plan', callback_data: 'plan:clear' }],
] };

const answer = (h: ReturnType<typeof harness>) => h.calls('answerCallbackQuery').at(-1)!.payload.text;

it('/schedule offers both choices and reports that nothing is planned', async () => {
  const h = harness();
  await h.updates.handleUpdate(h.event.command('/schedule', 11, 11), now);
  expect(last(h)).toEqual({ chat: 11, text: `${INTRO}\n\nNothing is planned.`, markup: KEYBOARD });
});

it('On duty is stored for the next sign-up and shown back', async () => {
  const h = harness();
  await h.updates.handleUpdate(h.event.callback('plan:duty', 11, 5, 11), now);
  expect(answer(h)).toBe("You're on duty at the next sign-up");
  expect(last(h)).toEqual({ chat: 11, text: `${INTRO}\n\nPlanned: 🛡 On duty.`, markup: KEYBOARD });
  expect(h.store.get('plan:11')).toEqual({ user: { id: 11, name: 'Person 11' }, choice: 'duty', at: now.toISOString() });
});

it('a planned check-in without a Flipper name is refused', async () => {
  const h = harness();
  await h.updates.handleUpdate(h.event.callback('plan:checkin', 11, 5, 11), now);
  expect(answer(h)).toBe('Set your Flipper name first');
  expect(last(h)).toEqual({ chat: 11, text: 'The helper looks you up in Flipper, so a check-in needs your Flipper name. Send /flipper to set it, then plan again.', markup: KEYBOARD });
  expect(h.store.get('plan:11')).toBeUndefined();
});

it('a check-in can be planned once the Flipper name exists', async () => {
  const h = harness(); h.register(11, 'Anna K');
  await h.updates.handleUpdate(h.event.callback('plan:checkin', 11, 5, 11), now);
  expect(answer(h)).toBe("You're signed up for the next check-in");
  expect(h.store.get('plan:11')).toMatchObject({ choice: 'checkin' });
});

it('a plan made the night before is in the sign-up message the moment it opens', async () => {
  const h = harness(); h.register(22, 'Anna K');
  await h.updates.handleUpdate(h.event.callback('plan:duty', 11, 5, 11), now);
  await h.updates.handleUpdate(h.event.callback('plan:checkin', 22, 5, 22), now);
  await h.scheduler.tick(at('09:00'));
  expect(String(h.calls('sendMessage').at(-1)!.payload.text)).toContain('🙋 Need check-in · 1\nPerson 22\n\n🛡 On duty · 1\nPerson 11');
  expect(h.day().signup!.choices).toMatchObject({ 11: { choice: 'duty' }, 22: { choice: 'checkin' } });
});

it('a plan is used once and is gone afterwards', async () => {
  const h = harness();
  await h.updates.handleUpdate(h.event.callback('plan:duty', 11, 5, 11), now);
  await h.scheduler.tick(at('09:00'));
  expect(h.store.get('plan:11')).toBeNull();
});

it('a plan older than seven days is dropped instead of applied', async () => {
  const h = harness();
  h.store.set('plan:11', { user: { id: 11, name: 'Person 11' }, choice: 'duty', at: at('09:00', '2026-09-22').toISOString() });
  await h.scheduler.tick(at('09:00'));
  expect(h.day().signup!.choices).toEqual({});
  expect(h.store.get('plan:11')).toBeNull();
});

it('a planned check-in whose Flipper name disappeared is dropped with a private notice', async () => {
  const h = harness(); h.register(11, 'Anna K');
  await h.updates.handleUpdate(h.event.callback('plan:checkin', 11, 5, 11), now);
  h.store.set('flipper:11', null);
  await h.scheduler.tick(at('09:00'));
  await h.updates.flushReplies(at('09:00'));
  expect(h.day().signup!.choices).toEqual({});
  expect(sent(h).at(-1)).toMatchObject({ chat: 11, text: 'I could not sign you up for a check-in today: your Flipper name is gone. Send /flipper to set it again.' });
});

// Plans are stored next to the real days, and a test run works on a store of its own.
it('an interactive test run leaves a real plan untouched', async () => {
  const h = harness();
  const clock = () => at('18:00', '2026-09-29');
  const config = { token: '123456:dummy_dummy_dummy', chatId: groupId, database: ':memory:', heartbeat: '', schedule };
  const runtime = createRuntime(config, h.store, h.telegram, clock, 'office_test_bot');
  const step = async (...updates: Update[]) => { h.mock.updates.push(...updates); await runtime.step(); };
  const find = (part: string) => [...h.mock.messages.entries()].find(([, p]) => String(p.text).includes(part))!;
  await step(h.event.callback('plan:duty', 11, 5, 11));
  await step(h.event.command('/test'));
  const panel = find('<b>Test flow</b>');
  const open = (panel[1].reply_markup as InlineKeyboardMarkup).inline_keyboard.flat().find(b => b.text === 'Open test sign-up')!;
  await step(h.event.callback('callback_data' in open ? open.callback_data : '', 11, panel[0], groupId));
  expect(String(find('[TEST] 🏢 Office')[1].text)).toContain('🛡 On duty · 0');
  expect(h.store.get('plan:11')).toMatchObject({ choice: 'duty' });
});

it('Clear plan takes the plan away', async () => {
  const h = harness();
  await h.updates.handleUpdate(h.event.callback('plan:duty', 11, 5, 11), now);
  await h.updates.handleUpdate(h.event.callback('plan:clear', 11, 5, 11), now);
  expect(answer(h)).toBe('Your plan was removed');
  expect(last(h)).toEqual({ chat: 11, text: `${INTRO}\n\nNothing is planned.`, markup: KEYBOARD });
  expect(h.store.get('plan:11')).toBeNull();
});
