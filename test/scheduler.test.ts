import { afterEach, expect, it } from 'vitest';
import { harness, at } from './helpers/harness.js';
import { applyPollUpdate } from '../src/updates.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const instances: ReturnType<typeof harness>[] = [];
function setup(choose = (_n: number) => 0) { const h = harness(':memory:', choose); instances.push(h); return h; }
afterEach(() => instances.splice(0).forEach(h => h.store.close()));
it('opens exactly two polls at nine, without duplicates on later ticks', async () => {
  const h = setup(); await h.scheduler.tick(at('08:59')); expect(h.calls('sendPoll')).toHaveLength(0);
  await h.scheduler.tick(at('09:00')); await h.scheduler.tick(at('09:01'));
  expect(h.calls('sendPoll')).toHaveLength(2);
  expect(h.calls('sendPoll')[1].payload.question).toBe("Who's coming to the office and can help? (2026-09-30)");
});
it.each([['10:00', '2026-09-30'], ['09:00', '2026-10-04'], ['09:59:56', '2026-09-30']])('does not open after deadline, on weekends, or in the last five seconds (%s %s)', async (time, day) => {
  const h = setup(); await h.scheduler.tick(new Date(`${day}T${time.length === 5 ? `${time}:00` : time}+02:00`)); expect(h.calls('sendPoll')).toHaveLength(0);
});
it('recovers a failed poll independently', async () => {
  const h = setup(); h.mock.failures.set('sendPoll', { code: 429, retryAfter: 60 }); await h.scheduler.tick(at('09:00'));
  h.mock.failures.clear(); await h.scheduler.tick(at('09:01')); expect(Object.keys(h.day().polls)).toHaveLength(2);
  await h.scheduler.tick(at('09:02')); expect(h.calls('sendPoll')).toHaveLength(4);
});
it('keeps only the latest vote including retraction and ignores foreign polls', async () => {
  const h = setup(); await h.scheduler.tick(at('09:00'));
  h.vote('request', 22); h.vote('request', 22, 1); h.vote('request', 33); h.vote('request', 33, null); h.vote('helper', 11);
  applyPollUpdate(h.store, h.event.vote('foreign', 99, 0)); await h.close();
  expect(h.day().phase).toBe('empty'); expect(h.calls('sendMessage').at(-1)?.payload.text).toContain('No check-ins');
});
it.each([0, 1])('selects candidate %s, freezes names and excludes self', async index => {
  const h = setup(() => index); await h.scheduler.tick(at('09:00'));
  h.vote('helper', 11, 0, 'Alex'); h.vote('helper', 12, 0, 'Ana <&>'); h.vote('request', 11); h.vote('request', 12); h.vote('request', 22);
  await h.close(); const a = h.day().assignment!;
  expect(a.helper.id).toBe(index === 0 ? 11 : 12); expect(a.recipients).toHaveLength(2); expect(a.recipients.map(p => p.id)).not.toContain(a.helper.id);
  const sent = h.calls('sendMessage').at(-1)!; expect(sent.payload.text).toContain('you won!');
  if (index === 1) expect(sent.payload.text).toContain('Ana &lt;&amp;&gt;');
  expect(sent.payload.reply_markup).toEqual({ inline_keyboard: [[{ text: "I've checked everyone in", callback_data: 'done:2026-09-30' }]] });
  applyPollUpdate(h.store, h.event.vote(h.day().polls.helper!.id, 11, null)); await h.close();
  expect(h.day().assignment).toEqual(a); expect(h.calls('sendMessage')).toHaveLength(1);
});
it('announces missing helpers without inventing a completion', async () => {
  const h = setup(); await h.scheduler.tick(at('09:00')); h.vote('request', 22); await h.close();
  expect(h.day().phase).toBe('no_helpers'); expect(h.day().assignment).toBeUndefined();
});
it('does not assign a self-only check-in', async () => {
  const h = setup(); await h.scheduler.tick(at('09:00')); h.vote('request', 11); h.vote('helper', 11); await h.close(); expect(h.day().phase).toBe('empty');
});
it('waits for complete final counts before freezing a choice', async () => {
  const h = setup(); await h.scheduler.tick(at('09:00')); h.vote('request', 22); h.vote('helper', 11);
  h.mock.polls.get(h.day().polls.helper!.messageId)!.options[0].voter_count = 2;
  h.mock.polls.get(h.day().polls.helper!.messageId)!.total_voter_count = 2;
  await h.close(); expect(h.day().phase).toBe('incomplete'); expect(h.day().assignment).toBeUndefined();
  h.vote('helper', 12); await h.scheduler.finishClosing(at('10:01')); expect(h.day().assignment).toBeDefined();
});
it('handles Telegram auto-closure and older published polls after an outage', async () => {
  const h = setup(); await h.scheduler.tick(at('09:00')); h.vote('request', 22); h.vote('helper', 11);
  for (const poll of h.mock.polls.values()) { poll.is_closed = true; applyPollUpdate(h.store, { update_id: 100, poll }); }
  await h.scheduler.tick(at('11:00', '2026-10-01')); await h.scheduler.finishClosing(at('11:00', '2026-10-01'));
  expect(h.day().assignment?.day).toBe('2026-09-30'); expect(h.calls('sendPoll')).toHaveLength(2);
});
it('reattaches a poll whose successful send was saved just before a crash', async () => {
  const h = setup(); await h.scheduler.tick(at('09:00'));
  const day = h.day(); delete day.polls.helper; h.store.set(`day:${day.day}`, day);
  await h.scheduler.tick(at('10:00'));
  expect(h.day().polls.helper?.id).toBe('poll-2'); expect(h.calls('sendPoll')).toHaveLength(2);
});
it('retains a frozen draw across a real database reopen without resending', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'office-draw-')); const path = join(dir, 'office.db');
  const first = harness(path); await first.scheduler.tick(at('09:00')); first.vote('helper', 11); first.vote('request', 22); await first.close();
  const assignment = first.day().assignment; first.store.close();
  const second = harness(path, () => { throw Error('Must not redraw'); });
  try { await second.scheduler.tick(at('10:01')); expect(second.day().assignment).toEqual(assignment); expect(second.mock.calls).toHaveLength(0); }
  finally { second.store.close(); rmSync(dir, { recursive: true }); }
});
