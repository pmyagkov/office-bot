import { expect, it } from 'vitest';
import { at, harness } from './helpers/harness.js';
import { groupId } from './fixtures/telegram-updates.js';

const now = at('09:30');
const sent = (h: ReturnType<typeof harness>) => h.calls('sendMessage').map(c => ({ chat: c.payload.chat_id, text: c.payload.text }));
const nudge = (command: string) =>
  `${command} only works in my private chat. Open <a href="https://t.me/office_test_bot">@office_test_bot</a>, press Start, then send ${command} there.`;

// A command the bot does not own is probably meant for another bot in the group.
it.each(['/poll', '/vote', '/settings', '/cancel'])('%s in the office group stays unanswered', async (command) => {
  const h = harness();
  await h.updates.handleUpdate(h.event.command(command, groupId, 11), now);
  expect(sent(h)).toEqual([]);
});

it.each(['/start', '/flipper', '/schedule', '/admin', '/today', '/stats', '/history', '/test', '/help'])(
  '%s in the office group points to the private chat and does nothing else', async (command) => {
    const h = harness();
    await h.scheduler.tick(at('09:00'));
    const before = h.calls('sendMessage').length;
    await h.updates.handleUpdate(h.event.command(command, groupId, 11), now);
    expect(sent(h).slice(before)).toEqual([{ chat: groupId, text: nudge(command) }]);
  });

it('answers the command in the group only once, even addressed by name', async () => {
  const h = harness();
  await h.updates.handleUpdate(h.event.command('/today@office_test_bot', groupId, 11), now);
  await h.updates.handleUpdate(h.event.command('/today@other_bot', groupId, 11), now);
  expect(sent(h)).toEqual([{ chat: groupId, text: nudge('/today') }]);
});
