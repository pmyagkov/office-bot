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
  [{ text: '🗑 Clear plan', callback_data: 'plan:clear' }],
  [{ text: '❌ Close', callback_data: 'plan:close' }],
] };

const answer = (h: ReturnType<typeof harness>) => h.calls('answerCallbackQuery').at(-1)!.payload.text;
// A press closes the menu: the panel is rewritten in place, without its buttons.
const closed = (h: ReturnType<typeof harness>) => {
  const edit = h.calls('editMessageText').at(-1)!.payload;
  return { chat: edit.chat_id, message: edit.message_id, text: edit.text, markup: edit.reply_markup };
};
// Only people in the office group may put themselves into its sign-up.
function setup() {
  const h = harness();
  h.mock.members.set(11, 'member'); h.mock.members.set(22, 'member');
  return h;
}

it('somebody outside the office group cannot plan a sign-up', async () => {
  const h = setup();
  await h.updates.handleUpdate(h.event.callback('plan:duty', 33, 5, 33), now);
  expect(answer(h)).toBe('Not available.');
  expect(h.store.get('plan:33')).toBeUndefined();
});

it('/schedule offers both choices and reports that nothing is planned', async () => {
  const h = setup();
  await h.updates.handleUpdate(h.event.command('/schedule', 11, 11), now);
  expect(last(h)).toEqual({ chat: 11, text: `${INTRO}\n\nNothing is planned.`, markup: KEYBOARD });
});

it('On duty is stored and closes the menu in place', async () => {
  const h = setup();
  const before = h.calls('sendMessage').length;
  await h.updates.handleUpdate(h.event.callback('plan:duty', 11, 5, 11), now);
  expect(answer(h)).toBe("You're on duty at the next sign-up");
  expect(closed(h)).toEqual({ chat: 11, message: 5, text: 'Planned: 🛡 On duty — I apply it when the next sign-up opens.\n\nSend /schedule to change it.', markup: { inline_keyboard: [] } });
  expect(h.calls('sendMessage')).toHaveLength(before);
  expect(h.store.get('plan:11')).toEqual({ user: { id: 11, name: 'Person 11' }, choice: 'duty', at: now.toISOString() });
});

it('Close changes nothing and closes the menu', async () => {
  const h = setup();
  await h.updates.handleUpdate(h.event.callback('plan:duty', 11, 5, 11), now);
  await h.updates.handleUpdate(h.event.callback('plan:close', 11, 6, 11), now);
  expect(answer(h)).toBe('Closed');
  expect(closed(h)).toEqual({ chat: 11, message: 6, text: 'Planned: 🛡 On duty — I apply it when the next sign-up opens.\n\nSend /schedule to change it.', markup: { inline_keyboard: [] } });
  expect(h.store.get('plan:11')).toMatchObject({ choice: 'duty' });
});

it('a planned check-in without a Flipper name is refused', async () => {
  const h = setup();
  await h.updates.handleUpdate(h.event.callback('plan:checkin', 11, 5, 11), now);
  expect(answer(h)).toBe('Set your Flipper name first');
  expect(closed(h)).toEqual({ chat: 11, message: 5, text: 'The helper looks you up in Flipper, so a check-in needs your Flipper name. Send /flipper to set it, then /schedule to plan again.', markup: { inline_keyboard: [] } });
  expect(h.store.get('plan:11')).toBeUndefined();
});

it('a check-in can be planned once the Flipper name exists', async () => {
  const h = setup(); h.register(11, 'Anna K');
  await h.updates.handleUpdate(h.event.callback('plan:checkin', 11, 5, 11), now);
  expect(answer(h)).toBe("You're signed up for the next check-in");
  expect(h.store.get('plan:11')).toMatchObject({ choice: 'checkin' });
});

it('a plan made the night before is in the sign-up message the moment it opens', async () => {
  const h = setup(); h.register(22, 'Anna K');
  await h.updates.handleUpdate(h.event.callback('plan:duty', 11, 5, 11), now);
  await h.updates.handleUpdate(h.event.callback('plan:checkin', 22, 5, 22), now);
  await h.scheduler.tick(at('09:00'));
  expect(String(h.calls('sendMessage').at(-1)!.payload.text)).toContain('🙋 Need check-in · 1\nPerson 22\n\n🛡 On duty · 1\nPerson 11');
  expect(h.day().signup!.choices).toMatchObject({ 11: { choice: 'duty' }, 22: { choice: 'checkin' } });
});

it('a plan is used once and is gone afterwards', async () => {
  const h = setup();
  await h.updates.handleUpdate(h.event.callback('plan:duty', 11, 5, 11), now);
  await h.scheduler.tick(at('09:00'));
  expect(h.store.get('plan:11')).toBeNull();
});

it('a plan older than seven days is dropped instead of applied', async () => {
  const h = setup();
  h.store.set('plan:11', { user: { id: 11, name: 'Person 11' }, choice: 'duty', at: at('09:00', '2026-09-22').toISOString() });
  await h.scheduler.tick(at('09:00'));
  expect(h.day().signup!.choices).toEqual({});
  expect(h.store.get('plan:11')).toBeNull();
});

it('a planned check-in whose Flipper name disappeared is dropped with a private notice', async () => {
  const h = setup(); h.register(11, 'Anna K');
  await h.updates.handleUpdate(h.event.callback('plan:checkin', 11, 5, 11), now);
  h.store.set('flipper:11', null);
  await h.scheduler.tick(at('09:00'));
  await h.updates.flushReplies(at('09:00'));
  expect(h.day().signup!.choices).toEqual({});
  expect(sent(h).at(-1)).toMatchObject({ chat: 11, text: 'I could not sign you up for a check-in today: your Flipper name is gone. Send /flipper to set it again.' });
});

// A test run is a rehearsal of the day, so a plan has to show up in it — otherwise there is no
// way to see the feature work. It is copied, never consumed: the real sign-up still gets it.
it('an interactive test run shows a real plan without consuming it', async () => {
  const h = setup();
  const clock = () => at('18:00', '2026-09-29');
  const config = { token: '123456:dummy_dummy_dummy', chatId: groupId, database: ':memory:', heartbeat: '', schedule };
  const runtime = createRuntime(config, h.store, h.telegram, clock, 'office_test_bot');
  const step = async (...updates: Update[]) => { h.mock.updates.push(...updates); await runtime.step(); };
  const find = (part: string) => [...h.mock.messages.entries()].find(([, p]) => String(p.text).includes(part))!;
  await step(h.event.callback('plan:duty', 11, 5, 11));
  await step(h.event.dm('/test'));
  const panel = find('<b>Test flow</b>');
  const open = (panel[1].reply_markup as InlineKeyboardMarkup).inline_keyboard.flat().find(b => b.text === 'Open test sign-up')!;
  await step(h.event.callback('callback_data' in open ? open.callback_data : '', 11, panel[0], 11));
  expect(String(find('[TEST] 🏢 Office')[1].text)).toContain('🛡 On duty · 1\nPerson 11');
  expect(h.store.get('plan:11')).toMatchObject({ choice: 'duty' });
});

it('a test run does not put a planned check-in of somebody without a Flipper name in', async () => {
  const h = setup();
  h.store.set('plan:22', { user: { id: 22, name: 'Person 22' }, choice: 'checkin', at: at('18:00', '2026-09-29').toISOString() });
  const clock = () => at('18:00', '2026-09-29');
  const config = { token: '123456:dummy_dummy_dummy', chatId: groupId, database: ':memory:', heartbeat: '', schedule };
  const runtime = createRuntime(config, h.store, h.telegram, clock, 'office_test_bot');
  const step = async (...updates: Update[]) => { h.mock.updates.push(...updates); await runtime.step(); };
  const find = (part: string) => [...h.mock.messages.entries()].find(([, p]) => String(p.text).includes(part))!;
  await step(h.event.dm('/test'));
  const panel = find('<b>Test flow</b>');
  const open = (panel[1].reply_markup as InlineKeyboardMarkup).inline_keyboard.flat().find(b => b.text === 'Open test sign-up')!;
  await step(h.event.callback('callback_data' in open ? open.callback_data : '', 11, panel[0], 11));
  expect(String(find('[TEST] 🏢 Office')[1].text)).toContain('🙋 Need check-in · 0');
  // A rehearsal says nothing to anybody, and the plan is still there for the real sign-up.
  expect(h.calls('sendMessage').filter(c => c.payload.chat_id === 22)).toEqual([]);
  expect(h.store.get('plan:22')).toMatchObject({ choice: 'checkin' });
});

// An inline keyboard cannot also remove the reply keyboard an expired admin dialog left on
// screen, so /schedule has to send the notice separately instead of silently keeping it.
it('/schedule after an expired admin dialog takes the picker away first', async () => {
  const h = setup(); h.mock.members.set(11, 'administrator');
  await h.updates.handleUpdate(h.event.command('/admin flipper', 11, 11), now);
  await h.updates.handleUpdate(h.event.command('/schedule', 11, 11), new Date(now.getTime() + 3_600_000));
  expect(sent(h).slice(-2)).toEqual([
    { chat: 11, text: 'That admin session expired. Send /admin flipper to start again.', markup: { remove_keyboard: true } },
    { chat: 11, text: `${INTRO}\n\nNothing is planned.`, markup: KEYBOARD },
  ]);
});

it('Clear plan takes the plan away', async () => {
  const h = setup();
  await h.updates.handleUpdate(h.event.callback('plan:duty', 11, 5, 11), now);
  await h.updates.handleUpdate(h.event.callback('plan:clear', 11, 5, 11), now);
  expect(answer(h)).toBe('Your plan was removed');
  expect(closed(h)).toEqual({ chat: 11, message: 5, text: 'Nothing is planned.\n\nSend /schedule to plan your next sign-up.', markup: { inline_keyboard: [] } });
  expect(h.store.get('plan:11')).toBeNull();
});
