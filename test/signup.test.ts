import { afterEach, expect, it, vi } from 'vitest';
import type { CallbackQuery } from 'grammy/types';
import { openStore } from '../src/store.js';
import { applySignupPress } from '../src/input-state.js';
import { refreshSignups, signupKeyboard, signupText } from '../src/signup.js';
import { clockLabel, tag } from '../src/messages.js';
import type { Choice, DayState, Participant } from '../src/types.js';
import { events, groupId, user } from './fixtures/telegram-updates.js';

const zone = 'Europe/Belgrade';
const day = '2026-10-01';
const closesAt = '2026-10-01T08:00:00.000Z';
const messageId = 77;
const registered = new Set<number>();
const flipper = (id: number) => registered.has(id) ? `Flipper ${id}` : undefined;
const stores: ReturnType<typeof openStore>[] = [];
afterEach(() => { stores.splice(0).forEach(s => s.close()); registered.clear(); });

function setup(patch: Partial<DayState> = {}) {
  const store = openStore(':memory:'); stores.push(store);
  const state: DayState = { day, chatId: groupId, phase: 'open', polls: {}, signup: { messageId, closesAt, choices: {} }, ...patch };
  store.set(`day:${day}`, state);
  return store;
}
const get = (store: ReturnType<typeof openStore>) => store.get<DayState>(`day:${day}`)!;
const person = (id: number, name: string, username?: string): Participant => ({ id, name, ...(username ? { username } : {}) });
const withChoices = (list: [Participant, Choice][]): DayState['signup'] => ({
  messageId, closesAt, choices: Object.fromEntries(list.map(([u, choice]) => [String(u.id), { user: u, choice }])),
});
function press(action: Choice | 'discard', actor: number, name?: string, over: { messageId?: number; chatId?: number; day?: string } = {}): CallbackQuery {
  return events().press(over.day ?? day, action, actor, over.messageId ?? messageId, name, over.chatId).callback_query!;
}
const at = (iso: string) => new Date(iso);
const press1 = (store: ReturnType<typeof openStore>, cb: CallbackQuery, now = at('2026-10-01T07:00:00.000Z')) => applySignupPress(store, cb, now, 'office_bot', flipper);

it('renders both lists with Telegram names, counts and a dash for an empty list', () => {
  const full = { ...get(setup()), signup: withChoices([[person(1, 'Katerina S.'), 'checkin'], [person(2, 'Pasha M.', 'pasha'), 'checkin'], [person(3, 'Ivan S.'), 'duty'], [person(4, 'Tim P.'), 'duty'], [person(5, 'Max S.'), 'duty']]) } as DayState;
  expect(signupText(full, zone)).toBe([
    '🏢 Office · Thu, 1 Oct', '', '🙋 Need check-in · 2', 'Katerina S., Pasha M.', '', '🛡 On duty · 3', 'Ivan S., Tim P., Max S.', '', 'Sign-up closes at 10:00',
  ].join('\n'));
  expect(signupText(get(setup()), zone)).toBe([
    '🏢 Office · Thu, 1 Oct', '', '🙋 Need check-in · 0', '—', '', '🛡 On duty · 0', '—', '', 'Sign-up closes at 10:00',
  ].join('\n'));
  expect(signupKeyboard(full)).toEqual({ inline_keyboard: [
    [{ text: '🙋 Check me in', callback_data: 'signup:2026-10-01:checkin' }, { text: '🛡 On duty', callback_data: 'signup:2026-10-01:duty' }],
    [{ text: '❌ Discard', callback_data: 'signup:2026-10-01:discard' }],
  ] });
});

it('escapes <, & and emoji, and never adds @ or links', () => {
  const d = { ...get(setup()), signup: withChoices([[person(1, '<b>Tom</b> & Co 🦊', 'tom'), 'checkin'], [person(2, 'A"B', 'x'), 'duty']]) } as DayState;
  const text = signupText(d, zone);
  expect(text).toContain('&lt;b&gt;Tom&lt;/b&gt; &amp; Co 🦊');
  expect(text).toContain('A&quot;B');
  expect(text).not.toContain('@'); expect(text).not.toContain('<a'); expect(text).not.toContain('tg://');
});

it('falls back to "User <id>" for an empty first name', () => {
  const d = { ...get(setup()), signup: withChoices([[person(42, ''), 'checkin']]) } as DayState;
  expect(signupText(d, zone)).toContain('User 42');
  expect(tag(person(42, ''))).toBe('<a href="tg://user?id=42">User 42</a>');
  expect(tag(person(42, 'N', 'nick'))).toBe('@nick');
  expect(tag(person(42, '<N>'))).toBe('<a href="tg://user?id=42">&lt;N&gt;</a>');
  expect(clockLabel(closesAt, zone)).toBe('10:00');
});

it('moves a user between lists: checkin → duty → discard', () => {
  registered.add(5); const store = setup();
  expect(press1(store, press('checkin', 5, 'Kat'))).toEqual({ text: "You're signed up for a check-in" });
  expect(get(store).signup!.choices['5']).toEqual({ user: { id: 5, name: 'Kat' }, choice: 'checkin' });
  expect(press1(store, press('checkin', 5, 'Kat'))).toEqual({ text: "You're signed up for a check-in" });
  expect(Object.keys(get(store).signup!.choices)).toEqual(['5']);
  expect(press1(store, press('duty', 5, 'Kat B'))).toEqual({ text: "You're on duty" });
  expect(get(store).signup!.choices['5']).toEqual({ user: { id: 5, name: 'Kat B' }, choice: 'duty' });
  expect(press1(store, press('duty', 5, 'Kat B'))).toEqual({ text: "You're on duty" });
  expect(press1(store, press('discard', 5))).toEqual({ text: 'Your sign-up was removed' });
  expect(get(store).signup!.choices).toEqual({});
  expect(press1(store, press('discard', 5))).toEqual({ text: 'Your sign-up was removed' });
});

it('refreshes name and username on every press and ignores non-signup data and bots', () => {
  const store = setup(); const cb = press('duty', 9, 'Old'); cb.from.username = 'old';
  press1(store, cb);
  const next = press('duty', 9, 'New'); press1(store, next);
  expect(get(store).signup!.choices['9'].user).toEqual({ id: 9, name: 'New' });
  expect(press1(store, { ...press('duty', 9), data: 'done:2026-10-01' })).toBeUndefined();
  expect(press1(store, { ...press('duty', 9), data: undefined })).toBeUndefined();
  const bot = press('duty', 10); bot.from = { ...user(10), is_bot: true };
  press1(store, bot); expect(get(store).signup!.choices['10']).toBeUndefined();
  const named = press('duty', 11, 'Ann'); named.from.last_name = 'Lee'; press1(store, named);
  expect(get(store).signup!.choices['11'].user.name).toBe('Ann Lee');
});

it('unregistered checkin returns the deep-link url and records nothing; on duty and discard work unregistered', () => {
  const store = setup();
  expect(press1(store, press('checkin', 5, 'Kat'))).toEqual({ text: 'Register your Flipper name first. Opening the bot…', url: 'https://t.me/office_bot?start=flipper' });
  expect(get(store).signup!.choices).toEqual({});
  expect(press1(store, press('duty', 5, 'Kat'))).toEqual({ text: "You're on duty" });
  expect(press1(store, press('discard', 5, 'Kat'))).toEqual({ text: 'Your sign-up was removed' });
  expect(get(store).signup!.choices).toEqual({});
});

it('rejects wrong chat, wrong message id, closed phase, and a press at or after closesAt', () => {
  registered.add(5);
  const closed = { text: 'Sign-up is closed' };
  const store = setup(); const before = JSON.stringify(get(store));
  expect(press1(store, press('duty', 5, 'K', { chatId: -100999 }))).toEqual(closed);
  expect(press1(store, press('duty', 5, 'K', { messageId: 999 }))).toEqual(closed);
  expect(press1(store, press('duty', 5, 'K', { day: '2026-09-30' }))).toEqual(closed);
  expect(press1(store, { ...press('duty', 5), data: 'signup:../bad:duty' })).toEqual(closed);
  expect(press1(store, press('duty', 5, 'K'), at(closesAt))).toEqual(closed);
  expect(press1(store, press('checkin', 5, 'K'), at('2026-10-01T08:00:01.000Z'))).toEqual(closed);
  expect(press1(store, { ...press('duty', 5), message: undefined })).toEqual(closed);
  expect(JSON.stringify(get(store))).toBe(before);
  expect(press1(store, press('duty', 5, 'K'), at('2026-10-01T07:59:59.999Z'))).toEqual({ text: "You're on duty" });
  const shut = setup({ phase: 'assigned' }); const shutBefore = JSON.stringify(get(shut));
  expect(press1(shut, press('duty', 5, 'K'))).toEqual(closed);
  expect(JSON.stringify(get(shut))).toBe(shutBefore);
});

it('renders closed footers for assigned, empty and no_helpers and an empty keyboard once closed', () => {
  const helper = person(3, 'Ivan <S>', 'ivan');
  const signup = withChoices([[person(1, 'Kat'), 'checkin'], [helper, 'duty']]);
  const base = get(setup());
  const assigned = { ...base, phase: 'assigned', signup, assignment: { day, chatId: groupId, helper, recipients: [person(1, 'Kat')], messageId: 1, confirmedAt: null, rendered: false } } as DayState;
  expect(signupText(assigned, zone)).toBe([
    '🏢 Office · Thu, 1 Oct', '', '🙋 Need check-in · 1', 'Kat', '', '🛡 On duty · 1', 'Ivan &lt;S&gt;', '', '🔒 Sign-up closed · 🛡 Duty: Ivan &lt;S&gt;',
  ].join('\n'));
  expect(signupText({ ...base, phase: 'empty', signup: withChoices([[helper, 'duty']]) } as DayState, zone)).toContain('🔒 Sign-up closed · No check-ins needed today');
  expect(signupText({ ...base, phase: 'no_helpers', signup: withChoices([[person(1, 'Kat'), 'checkin']]) } as DayState, zone)).toContain('🔒 Sign-up closed · Nobody is on duty today');
  for (const phase of ['assigned', 'empty', 'no_helpers'] as const) expect(signupKeyboard({ ...base, phase })).toEqual({ inline_keyboard: [] });
  expect(signupKeyboard(base).inline_keyboard).toHaveLength(2);
});

it('refreshSignups edits once per change and retries after a failure', async () => {
  const store = setup(); const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  let fail = true;
  const editMessage = vi.fn(async () => { if (fail) { fail = false; throw new Error('boom'); } });
  await refreshSignups(store, { editMessage }, zone);
  expect(editMessage).toHaveBeenCalledTimes(1); expect(get(store).signup!.rendered).toBeUndefined();
  expect(log).toHaveBeenCalledWith(JSON.stringify({ event: 'signup_edit_failed', day }));
  await refreshSignups(store, { editMessage }, zone);
  expect(editMessage).toHaveBeenCalledTimes(2);
  expect(editMessage).toHaveBeenLastCalledWith(groupId, messageId, signupText(get(store), zone), signupKeyboard(get(store)));
  await refreshSignups(store, { editMessage }, zone);
  expect(editMessage).toHaveBeenCalledTimes(2);
  press1(store, press('duty', 5, 'K'));
  await refreshSignups(store, { editMessage }, zone);
  expect(editMessage).toHaveBeenCalledTimes(3);
  store.set('day:2026-09-30', { ...get(store), day: '2026-09-30', signup: undefined });
  store.set('day:2026-09-29', { ...get(store), day: '2026-09-29', signup: { messageId: null, closesAt, choices: {} } });
  await refreshSignups(store, { editMessage }, zone);
  expect(editMessage).toHaveBeenCalledTimes(3);
  log.mockRestore();
});

it('refreshSignups keeps a press that lands while the edit is in flight', async () => {
  const store = setup();
  const editMessage = vi.fn(async () => { press1(store, press('duty', 5, 'K')); });
  await refreshSignups(store, { editMessage }, zone);
  expect(get(store).signup!.choices['5'].choice).toBe('duty');
  await refreshSignups(store, { editMessage }, zone);
  expect(editMessage).toHaveBeenCalledTimes(2);
});
