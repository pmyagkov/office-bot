import { afterEach, expect, it } from 'vitest';
import type { InlineKeyboardMarkup, Update } from 'grammy/types';
import { createRuntime } from '../src/runtime.js';
import { dutyCredits } from '../src/ranking.js';
import { harness, at, schedule } from './helpers/harness.js';
import { groupId } from './fixtures/telegram-updates.js';
import type { DayState } from '../src/types.js';
import type { TestSession } from '../src/test-flow.js';
const instances: ReturnType<typeof harness>[] = [];
afterEach(() => instances.splice(0).forEach(h => h.store.close()));
function setup(time = '18:00') {
  const h = harness(); instances.push(h); let now = at(time);
  const config = { token: '123456:dummy_dummy_dummy', chatId: groupId, database: ':memory:', heartbeat: '', schedule };
  let runtime = createRuntime(config, h.store, h.telegram, () => now, 'office_test_bot');
  const step = async (...updates: Update[]) => { h.mock.updates.push(...updates); await runtime.step(); };
  const find = (part: string) => [...h.mock.messages.entries()].find(([, p]) => String(p.text).includes(part));
  const panel = () => find('<b>Test flow</b>')!;
  const signup = () => find('[TEST] 🏢 Office');
  const signupSends = () => h.calls('sendMessage').filter(c => String(c.payload.text).startsWith('[TEST] 🏢 Office'));
  const assignmentSends = () => h.calls('sendMessage').filter(c => String(c.payload.text).includes('badge duty today'));
  const keyboard = (message: [number, Record<string, unknown>]) => (message[1].reply_markup as InlineKeyboardMarkup | undefined)?.inline_keyboard ?? [];
  function button(label: string, actor = 11, message = panel(), chat = groupId) {
    const data = keyboard(message).flat().find(b => b.text === label);
    expect(data, `Missing button ${label}: ${message[1].text}`).toBeDefined();
    return h.event.callback('callback_data' in data! ? data.callback_data : '', actor, message[0], chat);
  }
  // Presses go through the rewritten buttons of the [TEST] sign-up message.
  function press(action: 'checkin' | 'duty' | 'discard', actor: number) {
    const message = signup()!; const data = keyboard(message).flat().find(b => 'callback_data' in b && b.callback_data.endsWith(`:${action}`));
    expect(data, `Missing ${action} button: ${message[1].text}`).toBeDefined();
    return h.event.callback('callback_data' in data! ? data.callback_data : '', actor, message[0], groupId);
  }
  async function assign() {
    h.register(22); await step(h.event.command('/test')); await step(button('Open test sign-up'));
    await step(press('checkin', 22), press('duty', 11)); await step(button('Close & choose helper'));
    return find('badge duty today')!;
  }
  return { ...h, step, find, panel, signup, signupSends, assignmentSends, keyboard, button, press, assign, time: (value: string) => { now = at(value); }, restart: () => { runtime = createRuntime(config, h.store, h.telegram, () => now, 'office_test_bot'); } };
}
it('runs the manual flow through production polling, with real confirmation and separate statistics', async () => {
  const h = setup(); await h.step(h.event.command('/test@office_test_bot'));
  expect(h.signup()).toBeUndefined(); expect(h.panel()[1].text).toContain('[TEST]');
  expect(h.panel()[1].text).toContain('sign-up'); expect(h.panel()[1].text).not.toMatch(/poll/i);
  await h.step(h.button('Open test sign-up'));
  expect(h.signupSends()).toHaveLength(1); expect(h.keyboard(h.signup()!).flat().every(b => 'callback_data' in b && b.callback_data.startsWith('testsignup:'))).toBe(true);
  await h.step(h.press('checkin', 22));
  expect(h.calls('answerCallbackQuery').at(-1)?.payload).toMatchObject({ text: 'Register your Flipper name first. Opening the bot…', url: 'https://t.me/office_test_bot?start=flipper' });
  h.register(22); await h.step(h.press('checkin', 22), h.press('duty', 11));
  expect(h.calls('answerCallbackQuery').at(-1)?.payload.text).toBe("You're on duty");
  expect(h.signup()![1].text).toContain('Person 22'); expect(h.signup()![1].text).toContain('Person 11');
  await h.step(h.button('Close & choose helper'));
  const assignment = h.find('badge duty today')!;
  expect(assignment[1].text).toContain('[TEST]'); expect(assignment[1].text).toContain('• F22'); expect(assignment[1].text).toContain('tg://user?id=11');
  expect(h.keyboard(h.signup()!)).toEqual([]); expect(h.signup()![1].text).toContain('Sign-up closed');
  expect(h.calls('sendMessage').filter(c => c.payload.chat_id === 11)).toHaveLength(0);
  const reminder = h.button('Send test reminder'); await h.step(reminder, reminder);
  expect(h.calls('sendMessage').filter(c => c.payload.chat_id === 11)).toHaveLength(1);
  await h.step(h.button("I've checked everyone in", 22, assignment));
  expect(h.panel()[1].text).not.toContain('Check-ins confirmed');
  await h.step(h.button("I've checked everyone in", 11, assignment));
  expect(h.panel()[1].text).toContain('Check-ins confirmed');
  expect(h.mock.messages.get(assignment[0])?.text).toContain('✅ Confirmed');
  await h.step(h.button('Show test stats'));
  expect(h.calls('sendMessage').at(-1)?.payload.text).toContain('1 duties');
  expect(h.calls('sendMessage').at(-1)?.payload.text).toContain('[TEST]');
  await h.step(h.event.command('/stats'));
  expect(h.calls('sendMessage').at(-1)?.payload.text).not.toContain('1 duties');
  expect(h.store.list('day:')).toEqual([]);
  await h.step(h.button('End test'));
  expect(h.panel()[1].text).toContain('Test ended');
});
it('limits control to the starter and original panel, deduplicates steps and survives restart', async () => {
  const h = setup(); await h.step(h.event.command('/test', 11), h.event.command('/test@another_bot'));
  expect(h.calls('sendMessage')).toHaveLength(0);
  await h.step(h.event.command('/test'));
  await h.step(h.button('Open test sign-up', 22)); await h.step(h.button('Open test sign-up', 11, h.panel(), -100999));
  const forged = h.button('Open test sign-up'); forged.callback_query!.message!.message_id = 999;
  await h.step(forged); expect(h.signupSends()).toHaveLength(0);
  await h.step(h.event.command('/test', groupId, 22));
  expect([...h.mock.messages.values()].filter(p => String(p.text).includes('<b>Test flow</b>'))).toHaveLength(1);
  const open = h.button('Open test sign-up'); await h.step(open); h.restart(); await h.step(open);
  expect(h.signupSends()).toHaveLength(1);
  h.register(22); await h.step(h.press('checkin', 22), h.press('duty', 11)); await h.step(h.button('Close & choose helper'));
  h.restart(); await h.step();
  expect(h.assignmentSends()).toHaveLength(1);
});
it('ends an unfinished test, removes its sign-up buttons and rejects old controls', async () => {
  const h = setup(); await h.step(h.event.command('/test')); const open = h.button('Open test sign-up');
  await h.step(open); const close = h.button('Close & choose helper'); const late = h.press('duty', 11);
  await h.step(h.button('End test'));
  expect(h.keyboard(h.signup()!)).toEqual([]); expect(h.signup()![1].text).toContain('Test ended');
  late.update_id = h.event.command('/unused').update_id; await h.step(late);
  expect(h.calls('answerCallbackQuery').at(-1)?.payload.text).toBe('This test has ended. Send /test to start a new one.');
  close.update_id = h.event.command('/unused').update_id; await h.step(close);
  expect(h.assignmentSends()).toHaveLength(0);
  expect(h.store.list<TestSession>('test-session:')[0]).toMatchObject({ stage: 'ended', cleanupPending: false });
});
it('shows blocked reminders, never retries them blindly, and expires abandoned runs', async () => {
  const h = setup(); const assignment = await h.assign();
  h.mock.failures.set('sendMessage', { code: 403 }); await h.step(h.button('Send test reminder'));
  expect(h.panel()[1].text).toContain('/start'); expect(h.panel()[1].text).toContain('403');
  await h.step(); expect(h.calls('sendMessage').filter(c => c.payload.chat_id === 11)).toHaveLength(1);
  h.time('19:01'); await h.step(); expect(h.panel()[1].text).toContain('Test ended');
  expect((h.mock.messages.get(assignment[0])!.reply_markup as InlineKeyboardMarkup).inline_keyboard).toEqual([]);
});
it('restores delivered panel and assignment identities before consuming queued callbacks after a crash', async () => {
  const h = setup(); await h.step(h.event.command('/test')); const open = h.button('Open test sign-up');
  const session = h.store.list<TestSession>('test-session:')[0]; delete session.panelId; h.store.set(`test-session:${session.id}`, session);
  h.restart(); await h.step(open); expect(h.signupSends()).toHaveLength(1);
  h.register(22); await h.step(h.press('checkin', 22), h.press('duty', 11)); await h.step(h.button('Close & choose helper'));
  const assignment = h.find('badge duty today')!;
  const key = `test:${session.id}:day:${session.day}`; const day = h.store.get<DayState>(key)!;
  day.assignment!.messageId = null; h.store.set(key, day);
  h.restart(); await h.step(h.button("I've checked everyone in", 11, assignment));
  expect(h.store.get<DayState>(key)?.assignment?.confirmedAt).toBe(at('18:00').toISOString());
  expect(h.assignmentSends()).toHaveLength(1);
});
it('suppresses the manual reminder when confirmation is already queued in the same update batch', async () => {
  const h = setup(); const assignment = await h.assign();
  await h.step(h.button('Send test reminder'), h.button("I've checked everyone in", 11, assignment));
  expect(h.calls('sendMessage').filter(c => c.payload.chat_id === 11)).toHaveLength(0);
});
it('keeps the scheduled sign-up and statistics independent while a test runs in the morning', async () => {
  const h = setup('09:05'); await h.step(); await h.step(h.event.command('/test')); await h.step(h.button('Open test sign-up'));
  const normal = h.mock.messages.get(h.day().signup!.messageId!)!;
  expect(String(normal.text)).not.toContain('[TEST]'); expect(h.signupSends()).toHaveLength(1);
  h.register(22); await h.step(h.press('checkin', 22), h.press('duty', 11)); await h.step(h.button('Close & choose helper'));
  expect(h.day().signup?.choices).toEqual({}); expect(h.day().phase).toBe('open');
  expect((h.mock.messages.get(h.day().signup!.messageId!)!.reply_markup as InlineKeyboardMarkup).inline_keyboard).not.toEqual([]);
  expect(h.keyboard(h.signup()!)).toEqual([]);
  h.time('10:00'); await h.step(); expect(h.day().phase).toBe('empty');
  expect(h.day().assignment).toBeUndefined(); expect(h.panel()[1].text).toContain('Selected helper');
});
it('does not repeat an uncertain sign-up delivery after restart, and reports the problem', async () => {
  const h = setup(); await h.step(h.event.command('/test')); h.mock.failures.set('sendMessage', { code: 500 });
  await h.step(h.button('Open test sign-up')); expect(h.panel()[1].text).toContain('unknown');
  h.mock.failures.clear(); h.restart(); await h.step(); expect(h.signupSends()).toHaveLength(1);
  await h.step(h.button('End test')); expect(h.panel()[1].text).toContain('Test ended');
});
it('keeps empty outcomes navigable and permits a fresh run after ending', async () => {
  const h = setup(); await h.step(h.event.command('/test')); await h.step(h.button('Open test sign-up'));
  await h.step(h.button('Close & choose helper')); expect(h.panel()[1].text).toContain('No check-ins needed');
  await h.step(h.button('End test')); await h.step(h.event.command('/test'));
  expect([...h.mock.messages.values()].filter(p => String(p.text).includes('<b>Test flow</b>'))).toHaveLength(2);
});
it('ends even when Telegram cannot edit the assignment, allowing a new test immediately', async () => {
  const h = setup(); const assignment = await h.assign(); const confirm = h.button("I've checked everyone in", 11, assignment);
  h.mock.failures.set('editMessageText', { code: 400 }); await h.step(h.button('End test'));
  await h.step(h.event.command('/test'));
  expect([...h.mock.messages.values()].filter(p => String(p.text).includes('<b>Test flow</b>'))).toHaveLength(2);
  confirm.update_id = h.event.command('/unused').update_id; await h.step(confirm);
  expect(h.calls('answerCallbackQuery').at(-1)?.payload.text).toContain('ended');
  h.mock.failures.clear(); await h.step();
  expect((h.mock.messages.get(assignment[0])!.reply_markup as InlineKeyboardMarkup).inline_keyboard).toEqual([]);
});
it('explains rate limiting and retries the reminder after the Telegram delay', async () => {
  const h = setup(); await h.assign(); h.mock.failures.set('sendMessage', { code: 429, retryAfter: 30 });
  await h.step(h.button('Send test reminder'));
  expect(h.panel()[1].text).toContain('retry automatically');
  await h.step(); expect(h.calls('sendMessage').filter(c => c.payload.chat_id === 11)).toHaveLength(1);
  h.mock.failures.clear(); h.time('18:01'); await h.step();
  expect(h.panel()[1].text).toContain('Private test reminder sent');
  expect(h.calls('sendMessage').filter(c => c.payload.chat_id === 11)).toHaveLength(2);
});
it('test sign-up never changes real fair-share credits', async () => {
  const h = setup(); h.register(22); await h.step(h.event.command('/test')); await h.step(h.button('Open test sign-up'));
  await h.step(h.press('checkin', 22), h.press('duty', 11), h.press('duty', 12)); await h.step(h.button('Close & choose helper'));
  const session = h.store.list<TestSession>('test-session:')[0];
  const day = h.store.get<DayState>(`test:${session.id}:day:${session.day}`)!;
  expect(day.assignment?.onDuty?.map(p => p.id)).toEqual([11, 12]); expect(day.assignment?.recipients.map(p => p.flipperName)).toEqual(['F22']);
  const helper = day.assignment!.helper.id;
  await h.step(h.button("I've checked everyone in", helper, h.find('badge duty today')!)); await h.step(h.button('End test'));
  expect(dutyCredits(h.store.list<DayState>(`test:${session.id}:day:`), '2026-10-01').get(helper)).toBe(-0.5);
  expect(h.store.list('day:')).toEqual([]); expect(dutyCredits(h.store.list<DayState>('day:'), '2026-10-01').size).toBe(0);
});
