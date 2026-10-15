import { expect, it } from 'vitest';
import { at, harness } from './helpers/harness.js';
import { groupId } from './fixtures/telegram-updates.js';

const now = at('09:30');
const sent = (h: ReturnType<typeof harness>) => h.calls('sendMessage').map(c => ({ chat: c.payload.chat_id, text: String(c.payload.text) }));
const last = (h: ReturnType<typeof harness>) => sent(h).at(-1)!;

// In the group these were answered only where Telegram already guaranteed membership. In a
// private chat there is no such guarantee, so the bot has to ask.
it.each(['/today', '/stats', '/history', '/test'])('%s is refused to somebody outside the office group', async (command) => {
  const h = harness(); h.mock.members.set(11, 'member');
  await h.scheduler.tick(at('09:00'));
  const before = h.calls('sendMessage').length;
  await h.updates.handleUpdate(h.event.dm(command, 77), now);
  await h.updates.flushTestFlow(now);
  expect(sent(h).slice(before)).toEqual([{ chat: 77, text: 'Only members of the office group can use this.' }]);
});

it('a member keeps access to the reports', async () => {
  const h = harness(); h.mock.members.set(11, 'member');
  h.mock.members.set(77, 'member');
  await h.updates.handleUpdate(h.event.dm('/history', 77), now);
  expect(last(h)).toEqual({ chat: 77, text: expect.stringContaining('Recent confirmations') });
});

it('/today answers in the private chat', async () => {
  const h = harness(); h.mock.members.set(11, 'member');
  await h.scheduler.tick(at('09:00'));
  h.vote('request', 22); h.vote('helper', 33);
  await h.updates.handleUpdate(h.event.command('/today', 11, 11), now);
  expect(last(h).chat).toBe(11);
  expect(last(h).text).toContain('1 need a check-in, 1 on duty');
});

it('/stats and /stats month answer in the private chat', async () => {
  const h = harness(); h.mock.members.set(11, 'member');
  await h.updates.handleUpdate(h.event.command('/stats', 11, 11), now);
  expect(last(h)).toEqual({ chat: 11, text: expect.stringContaining('2026-09-28 to 2026-09-30') });
  await h.updates.handleUpdate(h.event.command('/stats month', 11, 11), now);
  expect(last(h)).toEqual({ chat: 11, text: expect.stringContaining('2026-09-01 to 2026-09-30') });
});

it('/history answers in the private chat', async () => {
  const h = harness(); h.mock.members.set(11, 'member');
  await h.updates.handleUpdate(h.event.command('/history', 11, 11), now);
  expect(last(h)).toEqual({ chat: 11, text: expect.stringContaining('Recent confirmations') });
});

// The test flow is driven from the private chat, but it is a rehearsal of the group's day, so
// its panel and its messages still belong in the group.
it('/test is started from the private chat and puts its panel in the group', async () => {
  const h = harness(); h.mock.members.set(11, 'member');
  await h.updates.handleUpdate(h.event.command('/test', 11, 11), now);
  await h.updates.flushTestFlow(now);
  expect(last(h).chat).toBe(groupId);
  expect(last(h).text).toContain('<b>Test flow</b>');
});
