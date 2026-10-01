import { afterEach, expect, it, vi } from 'vitest';
import { harness, at } from './helpers/harness.js';
import { renderStats } from '../src/reports.js';
import type { DayState } from '../src/types.js';
import { groupId } from './fixtures/telegram-updates.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const instances: ReturnType<typeof harness>[] = [];
function setup(choose = (_n: number) => 0) { const h = harness(':memory:', choose); instances.push(h); return h; }
afterEach(() => { instances.splice(0).forEach(h => h.store.close()); vi.restoreAllMocks(); });
const signupButtons = { inline_keyboard: [
  [{ text: '🙋 Check me in', callback_data: 'signup:2026-09-30:checkin' }, { text: '🛡 On duty', callback_data: 'signup:2026-09-30:duty' }],
  [{ text: '❌ Discard', callback_data: 'signup:2026-09-30:discard' }],
] };
it('opens exactly one sign-up message at nine, without duplicates', async () => {
  const h = setup(); await h.scheduler.tick(at('08:59')); expect(h.calls('sendMessage')).toHaveLength(0);
  await h.scheduler.tick(at('09:00')); await h.scheduler.tick(at('09:01'));
  expect(h.calls('sendMessage')).toHaveLength(1); expect(h.calls('editMessageText')).toHaveLength(0);
  const sent = h.calls('sendMessage')[0].payload;
  expect(String(sent.text).startsWith('🏢 Office')).toBe(true); expect(sent.text).toContain('Sign-up closes at 10:00');
  expect(sent).toMatchObject({ chat_id: groupId, reply_markup: signupButtons });
  expect(h.day()).toMatchObject({ phase: 'open', signup: { messageId: 1, closesAt: at('10:00').toISOString(), choices: {} } });
  expect(h.day()).not.toHaveProperty('polls');
});
it.each([['10:00', '2026-09-30'], ['09:00', '2026-10-04'], ['09:59:56', '2026-09-30']])('does not open after deadline, on weekends, or in the last five seconds (%s %s)', async (time, day) => {
  const h = setup(); await h.scheduler.tick(new Date(`${day}T${time.length === 5 ? `${time}:00` : time}+02:00`)); expect(h.calls('sendMessage')).toHaveLength(0);
});
it('retries a rate-limited sign-up message without duplicates', async () => {
  const h = setup(); h.mock.failures.set('sendMessage', { code: 429, retryAfter: 60 }); await h.scheduler.tick(at('09:00'));
  expect(h.day().signup?.messageId).toBeNull();
  h.mock.failures.clear(); await h.scheduler.tick(at('09:01')); await h.scheduler.tick(at('09:02'));
  expect(h.calls('sendMessage')).toHaveLength(2); expect(h.day().signup?.messageId).toBe(1);
});
it('closes by itself at ten with no Telegram involvement', async () => {
  const h = setup(); await h.scheduler.tick(at('09:00')); h.vote('helper', 11); h.vote('request', 22);
  await h.scheduler.tick(at('09:59')); expect(h.day().phase).toBe('open');
  await h.scheduler.tick(at('10:00'));
  expect(h.day().phase).toBe('assigned'); expect(h.calls('stopPoll')).toHaveLength(0); expect(h.calls('sendPoll')).toHaveLength(0);
  expect(h.calls('getUpdates')).toHaveLength(0);
});
it('keeps only the latest choice including discard', async () => {
  const h = setup(); await h.scheduler.tick(at('09:00'));
  h.vote('request', 22); h.vote('helper', 22); h.vote('request', 33); h.vote('request', 33, null); h.vote('helper', 11); h.press('duty', 44); h.press('discard', 44);
  expect(Object.fromEntries(Object.entries(h.day().signup!.choices).map(([id, c]) => [id, c.choice]))).toEqual({ 11: 'duty', 22: 'duty' });
  await h.close();
  expect(h.day().phase).toBe('empty'); expect(h.calls('sendMessage')).toHaveLength(1);
});
it.each([[0, 11], [1, 12]])('selects the fair-share helper and freezes Flipper names (index %s)', async (index, helper) => {
  const h = setup(() => index); await h.scheduler.tick(at('09:00'));
  h.vote('helper', 12, 0, 'Ana <&>'); h.vote('helper', 11, 0, 'Alex'); h.register(33, 'Flip <&>'); h.vote('request', 33); h.vote('request', 22);
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  await h.close(); const a = h.day().assignment!;
  expect(a.helper.id).toBe(helper); expect(a.onDuty?.map(p => p.id)).toEqual([11, 12]);
  expect(a.recipients.map(p => [p.id, p.flipperName])).toEqual([[22, 'F22'], [33, 'Flip <&>']]);
  expect(log).toHaveBeenCalledWith(JSON.stringify({ event: 'day_closed', day: '2026-09-30', phase: 'assigned', requests: 2, onDuty: 2, helper }));
  const sent = h.calls('sendMessage').at(-1)!; const text = String(sent.payload.text);
  expect(text).toContain('badge duty today'); expect(text).toContain('• F22'); expect(text).toContain('• Flip &lt;&amp;&gt;');
  expect(text).toContain(`<a href="tg://user?id=${helper}">`); expect(text).not.toContain('tg://user?id=22'); expect(text).not.toContain('tg://user?id=33');
  expect(sent.payload.reply_markup).toEqual({ inline_keyboard: [[{ text: "I've checked everyone in", callback_data: 'done:2026-09-30' }]] });
  h.register(22, 'Changed'); expect(h.press('discard', 11)).toEqual({ text: 'Sign-up is closed' }); await h.scheduler.tick(at('10:05'));
  expect(h.day().assignment).toEqual(a); expect(h.calls('sendMessage')).toHaveLength(2);
});
it('empty / no_helpers edit the sign-up footer and send no extra message', async () => {
  for (const [kind, phase, footer] of [['helper', 'empty', 'No check-ins needed today'], ['request', 'no_helpers', 'Nobody is on duty today']] as const) {
    const h = setup(); await h.scheduler.tick(at('09:00')); h.vote(kind, 22); await h.close();
    expect(h.day().phase).toBe(phase); expect(h.day().assignment).toBeUndefined(); expect(h.calls('sendMessage')).toHaveLength(1);
    expect(h.calls('editMessageText')).toHaveLength(1);
    expect(h.calls('editMessageText')[0].payload).toMatchObject({ message_id: 1, reply_markup: { inline_keyboard: [] } });
    expect(h.calls('editMessageText')[0].payload.text).toContain(`🔒 Sign-up closed · ${footer}`);
  }
});
it('self-only sign-up cannot happen (mutual exclusion)', async () => {
  const h = setup(); await h.scheduler.tick(at('09:00')); h.vote('request', 11); h.vote('helper', 11);
  expect(Object.keys(h.day().signup!.choices)).toEqual(['11']); await h.close(); expect(h.day().phase).toBe('empty');
});
it('closing is retried after a failed edit', async () => {
  const h = setup(); await h.scheduler.tick(at('09:00')); h.vote('helper', 11); h.vote('request', 22);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  h.mock.failures.set('editMessageText', { code: 500 }); await h.close();
  expect(h.day().phase).toBe('assigned'); expect(h.day().assignment?.messageId).toBe(2);
  const failed = h.calls('editMessageText').length; expect(failed).toBeGreaterThan(0);
  h.mock.failures.clear(); await h.scheduler.tick(at('10:01')); await h.scheduler.tick(at('10:02'));
  expect(h.calls('editMessageText')).toHaveLength(failed + 1);
  expect(h.calls('editMessageText').at(-1)?.payload).toMatchObject({ message_id: 1, reply_markup: { inline_keyboard: [] } });
  expect(h.calls('editMessageText').at(-1)?.payload.text).toContain('🔒 Sign-up closed · 🛡 Duty: Person 11');
  expect(h.calls('sendMessage')).toHaveLength(2);
});
it('routes sign-up presses through updates without confirmation errors', async () => {
  const h = setup(); await h.scheduler.tick(at('09:00'));
  await h.updates.handleUpdate(h.event.press('2026-09-30', 'checkin', 22, 1), at('09:10'));
  expect(h.calls('answerCallbackQuery').at(-1)?.payload).toMatchObject({ text: 'Register your Flipper name first. Opening the bot…', url: 'https://t.me/office_test_bot?start=flipper' });
  expect(h.calls('editMessageText')).toHaveLength(0);
  h.register(22); await h.updates.handleUpdate(h.event.press('2026-09-30', 'checkin', 22, 1, 'Kat'), at('09:11'));
  expect(h.calls('answerCallbackQuery').at(-1)?.payload).toMatchObject({ text: "You're signed up for a check-in" });
  expect(h.calls('answerCallbackQuery').at(-1)?.payload).not.toHaveProperty('url');
  expect(h.calls('editMessageText')).toHaveLength(1); expect(h.calls('editMessageText')[0].payload.text).toContain('🙋 Need check-in · 1\nKat');
  await h.updates.handleUpdate(h.event.press('2026-09-30', 'duty', 11, 99), at('09:12'));
  expect(h.calls('answerCallbackQuery').at(-1)?.payload).toMatchObject({ text: 'Sign-up is closed' });
  expect(h.calls('answerCallbackQuery').map(c => c.payload.text)).not.toContain('Only the assigned helper can confirm this assignment.');
  expect(h.store.get('offset')).toBe(4);
});
it('closes an older open day after an outage and publishes it', async () => {
  const h = setup(); await h.scheduler.tick(at('09:00')); h.vote('request', 22); h.vote('helper', 11);
  await h.scheduler.tick(at('11:00', '2026-10-01'));
  expect(h.day().assignment?.day).toBe('2026-09-30'); expect(h.calls('sendMessage')).toHaveLength(2);
  expect(h.store.get('day:2026-10-01')).toBeUndefined();
});
it('treats an unparsable closesAt as closed: presses are rejected and the next tick closes the day', async () => {
  const h = setup(); await h.scheduler.tick(at('09:00')); h.vote('helper', 11); h.vote('request', 22);
  const day = h.day(); day.signup!.closesAt = 'not a date'; h.store.set(`day:${day.day}`, day);
  expect(h.press('duty', 33)).toEqual({ text: 'Sign-up is closed' });
  vi.spyOn(console, 'info').mockImplementation(() => {});
  await h.scheduler.tick(at('09:30'));
  expect(h.day().phase).toBe('assigned'); expect(h.day().assignment?.helper.id).toBe(11);
});
it('reattaches a sign-up message whose successful send was saved just before a crash', async () => {
  const h = setup(); await h.scheduler.tick(at('09:00'));
  const day = h.day(); day.signup!.messageId = null; h.store.set(`day:${day.day}`, day);
  await h.scheduler.tick(at('09:05'));
  expect(h.day().signup?.messageId).toBe(1); expect(h.calls('sendMessage')).toHaveLength(1);
});
it('a legacy day with polls is never opened, closed or rendered', async () => {
  const h = setup();
  const person = (id: number) => ({ id, name: `Person ${id}` });
  const today: DayState = { day: '2026-09-30', chatId: groupId, phase: 'open', polls: { request: { id: 'p1', messageId: 1, closed: false, optionCounts: [0, 0], totalVoters: 0, votes: {} } } };
  const before: DayState = { day: '2026-09-29', chatId: groupId, phase: 'assigned', polls: { request: { id: 'p0' } },
    assignment: { day: '2026-09-29', chatId: groupId, helper: person(11), recipients: [person(22)], messageId: 5, confirmedAt: at('11:00', '2026-09-29').toISOString(), rendered: false } };
  h.store.set('day:2026-09-30', today); h.store.set('day:2026-09-29', before);
  for (const time of ['09:00', '10:00', '14:00']) await h.scheduler.tick(at(time));
  expect(h.mock.calls).toHaveLength(0);
  expect(h.store.get('day:2026-09-30')).toEqual(today); expect(h.store.get('day:2026-09-29')).toEqual(before);
  expect(renderStats(h.store, '2026-09-30', 'week')).toContain('1 duties · 1 check-ins performed');
});
it('two-day fair-share through the scheduler', async () => {
  const h = setup(); await h.scheduler.tick(at('09:00')); h.vote('helper', 11); h.vote('helper', 12); h.vote('request', 22); await h.close();
  expect(h.day().assignment?.helper.id).toBe(11);
  const thursday = (time: string) => at(time, '2026-10-01');
  await h.scheduler.tick(thursday('09:00'));
  const signup = h.store.get<DayState>('day:2026-10-01')!.signup!; expect(signup.messageId).toBe(3);
  for (const [action, id] of [['duty', 11], ['duty', 12], ['checkin', 22]] as const) await h.updates.handleUpdate(h.event.press('2026-10-01', action, id, 3), thursday('09:30'));
  await h.scheduler.tick(thursday('10:00'));
  expect(h.store.get<DayState>('day:2026-10-01')!.assignment?.helper.id).toBe(12);
});
it('retains a frozen draw across a real database reopen without resending', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'office-draw-')); const path = join(dir, 'office.db');
  const first = harness(path); await first.scheduler.tick(at('09:00')); first.vote('helper', 11); first.vote('request', 22); await first.close();
  const assignment = first.day().assignment; first.store.close();
  const second = harness(path, () => { throw Error('Must not redraw'); });
  try { await second.scheduler.tick(at('10:01')); expect(second.day().assignment).toEqual(assignment); expect(second.mock.calls).toHaveLength(0); }
  finally { second.store.close(); rmSync(dir, { recursive: true }); }
});
