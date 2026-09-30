import { afterEach, expect, it } from 'vitest';
import type { InlineKeyboardMarkup, Update } from 'grammy/types';
import { createRuntime } from '../src/runtime.js';
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
  const panel = () => [...h.mock.messages.entries()].find(([, p]) => String(p.text).includes('<b>Test flow</b>'))!;
  function button(label: string, actor = 11, message = panel(), chat = groupId) {
    const data = (message[1].reply_markup as InlineKeyboardMarkup).inline_keyboard.flat().find(b => b.text === label);
    expect(data, `Missing button ${label}: ${message[1].text}`).toBeDefined();
    const u = h.event.click('', actor, message[0], chat);
    u.callback_query!.data = 'callback_data' in data! ? data.callback_data : ''; return u;
  }
  const vote = (index: number, actor: number) => {
    const poll = [...h.mock.polls.values()][index];
    poll.options[0].voter_count++; poll.total_voter_count++;
    return h.event.vote(poll.id, actor, 0);
  };
  async function assign() {
    await step(h.event.command('/test')); await step(button('Open test polls'));
    await step(vote(0, 22), vote(1, 11)); await step(button('Close polls & choose helper'));
    return [...h.mock.messages.entries()].find(([, p]) => String(p.text).includes('you won!'))!;
  }
  return { ...h, step, panel, button, vote, assign, time: (value: string) => { now = at(value); }, restart: () => { runtime = createRuntime(config, h.store, h.telegram, () => now, 'office_test_bot'); } };
}
it('runs the manual flow through production polling, with real confirmation and separate statistics', async () => {
  const h = setup(); await h.step(h.event.command('/test@office_test_bot'));
  expect(h.calls('sendPoll')).toHaveLength(0); expect(h.panel()[1].text).toContain('[TEST]');
  await h.step(h.button('Open test polls'));
  expect(h.calls('sendPoll')).toHaveLength(2);
  expect(h.calls('sendPoll').every(c => String(c.payload.question).startsWith('[TEST]'))).toBe(true);
  await h.step(h.vote(0, 22), h.vote(1, 11)); await h.step(h.button('Close polls & choose helper'));
  const assignment = [...h.mock.messages.entries()].find(([, p]) => String(p.text).includes('you won!'))!;
  expect(assignment[1].text).toContain('Person 22');
  expect(h.calls('sendMessage').filter(c => c.payload.chat_id === 11)).toHaveLength(0);
  const reminder = h.button('Send test reminder'); await h.step(reminder, reminder);
  expect(h.calls('sendMessage').filter(c => c.payload.chat_id === 11)).toHaveLength(1);
  await h.step(h.button("I've checked everyone in", 22, assignment));
  expect(h.panel()[1].text).not.toContain('Check-ins confirmed');
  await h.step(h.button("I've checked everyone in", 11, assignment));
  expect(h.panel()[1].text).toContain('Check-ins confirmed');
  expect(h.mock.messages.get(assignment[0])?.text).toContain('confirmed check-ins');
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
  const h = setup(); await h.step(h.event.command('/test'));
  await h.step(h.button('Open test polls', 22)); await h.step(h.button('Open test polls', 11, h.panel(), -100999));
  const forged = h.button('Open test polls'); forged.callback_query!.message!.message_id = 999;
  await h.step(forged); expect(h.calls('sendPoll')).toHaveLength(0);
  await h.step(h.event.command('/test', groupId, 22));
  expect([...h.mock.messages.values()].filter(p => String(p.text).includes('<b>Test flow</b>'))).toHaveLength(1);
  const open = h.button('Open test polls'); await h.step(open); h.restart(); await h.step(open);
  expect(h.calls('sendPoll')).toHaveLength(2);
  await h.step(h.vote(0, 22), h.vote(1, 11)); await h.step(h.button('Close polls & choose helper'));
  h.restart(); await h.step();
  expect(h.calls('sendMessage').filter(c => String(c.payload.text).includes('you won!'))).toHaveLength(1);
});
it('ends an unfinished test, closes its polls and rejects old controls', async () => {
  const h = setup(); await h.step(h.event.command('/test')); const open = h.button('Open test polls');
  await h.step(open); const close = h.button('Close polls & choose helper');
  await h.step(h.button('End test')); expect([...h.mock.polls.values()].every(p => p.is_closed)).toBe(true);
  close.update_id += 100; await h.step(close);
  expect(h.calls('sendMessage').some(c => String(c.payload.text).includes('you won!'))).toBe(false);
});
it('shows blocked reminders, never retries them blindly, and expires abandoned runs', async () => {
  const h = setup(); const assignment = await h.assign();
  h.mock.failures.set('sendMessage', { code: 403 }); await h.step(h.button('Send test reminder'));
  expect(h.panel()[1].text).toContain('/start'); expect(h.panel()[1].text).toContain('403');
  await h.step(); expect(h.calls('sendMessage').filter(c => c.payload.chat_id === 11)).toHaveLength(1);
  h.time('19:01'); await h.step(); expect(h.panel()[1].text).toContain('Test ended');
  expect((h.mock.messages.get(assignment[0])!.reply_markup as InlineKeyboardMarkup).inline_keyboard).toEqual([]);
});
it('waits for every identified vote before drawing and ignores /test elsewhere', async () => {
  const h = setup(); await h.step(h.event.command('/test', 11), h.event.command('/test@another_bot'));
  expect(h.calls('sendMessage')).toHaveLength(0);
  await h.step(h.event.command('/test')); await h.step(h.button('Open test polls'));
  const lateVote = h.vote(0, 22); await h.step(h.vote(1, 11)); await h.step(h.button('Close polls & choose helper'));
  expect(h.calls('sendMessage').some(c => String(c.payload.text).includes('you won!'))).toBe(false);
  lateVote.update_id = h.event.command('/unused').update_id; await h.step(lateVote);
  expect(h.calls('sendMessage').filter(c => String(c.payload.text).includes('you won!'))).toHaveLength(1);
});
it('restores delivered panel and assignment identities before consuming queued callbacks after a crash', async () => {
  const h = setup(); await h.step(h.event.command('/test')); const open = h.button('Open test polls');
  const session = h.store.list<TestSession>('test-session:')[0]; delete session.panelId; h.store.set(`test-session:${session.id}`, session);
  h.restart(); await h.step(open); expect(h.calls('sendPoll')).toHaveLength(2);
  await h.step(h.vote(0, 22), h.vote(1, 11)); await h.step(h.button('Close polls & choose helper'));
  const assignment = [...h.mock.messages.entries()].find(([, p]) => String(p.text).includes('you won!'))!;
  const key = `test:${session.id}:day:${session.day}`; const day = h.store.get<DayState>(key)!;
  day.assignment!.messageId = null; h.store.set(key, day);
  h.restart(); await h.step(h.button("I've checked everyone in", 11, assignment));
  expect(h.store.get<DayState>(key)?.assignment?.confirmedAt).toBe(at('18:00').toISOString());
  expect(h.calls('sendMessage').filter(c => String(c.payload.text).includes('you won!'))).toHaveLength(1);
});
it('suppresses the manual reminder when confirmation is already queued in the same update batch', async () => {
  const h = setup(); const assignment = await h.assign();
  await h.step(h.button('Send test reminder'), h.button("I've checked everyone in", 11, assignment));
  expect(h.calls('sendMessage').filter(c => c.payload.chat_id === 11)).toHaveLength(0);
});
it('keeps scheduled polls and statistics independent while a test runs in the morning', async () => {
  const h = setup('09:05'); await h.step(); await h.step(h.event.command('/test')); await h.step(h.button('Open test polls'));
  const normal = [...h.mock.polls.values()].slice(0, 2); const test = [...h.mock.polls.values()].slice(2);
  expect(normal.every(p => !p.question.includes('[TEST]'))).toBe(true); expect(test.every(p => p.question.includes('[TEST]'))).toBe(true);
  await h.step(h.vote(2, 22), h.vote(3, 11)); await h.step(h.button('Close polls & choose helper'));
  expect(normal.every(p => !p.is_closed)).toBe(true); expect(test.every(p => p.is_closed)).toBe(true);
  h.time('10:00'); await h.step(); expect(normal.every(p => p.is_closed)).toBe(true);
  expect(h.day().assignment).toBeUndefined(); expect(h.panel()[1].text).toContain('Selected helper');
});
it('does not repeat an uncertain poll delivery after restart, and reports the problem', async () => {
  const h = setup(); await h.step(h.event.command('/test')); h.mock.failures.set('sendPoll', { code: 500 });
  await h.step(h.button('Open test polls')); expect(h.panel()[1].text).toContain('unknown');
  h.mock.failures.clear(); h.restart(); await h.step(); expect(h.calls('sendPoll')).toHaveLength(2);
  await h.step(h.button('End test')); expect(h.panel()[1].text).toContain('Test ended');
});
it('keeps empty outcomes navigable and permits a fresh run after ending', async () => {
  const h = setup(); await h.step(h.event.command('/test')); await h.step(h.button('Open test polls'));
  await h.step(h.button('Close polls & choose helper')); expect(h.panel()[1].text).toContain('No check-ins needed');
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
it('accepts late closed-poll snapshots while cleaning up an ended test', async () => {
  const h = setup(); await h.step(h.event.command('/test')); await h.step(h.button('Open test polls'));
  const stop = h.telegram.stopPoll; const queued = new Set<number>();
  h.telegram.stopPoll = async (chat, id) => {
    await stop(chat, id);
    if (!queued.has(id)) {
      queued.add(id);
      h.mock.updates.push({ update_id: h.event.command('/unused').update_id, poll: structuredClone(h.mock.polls.get(id)!) });
    }
    return null;
  };
  // Rebuild the runtime to use the wrapped transport, preserving the persisted run.
  h.restart(); await h.step(h.button('End test'));
  const session = h.store.list<TestSession>('test-session:')[0];
  expect(session.stage).toBe('ended'); expect(session.cleanupPending).toBe(false);
  expect(h.calls('sendMessage').some(c => String(c.payload.text).includes('you won!'))).toBe(false);
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
