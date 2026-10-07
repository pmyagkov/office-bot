import { expect, it } from 'vitest';
import { at, harness } from './helpers/harness.js';
import { groupId } from './fixtures/telegram-updates.js';

const now = at('09:30');
const sent = (h: ReturnType<typeof harness>) => h.calls('sendMessage').map(c => ({ chat: c.payload.chat_id, text: c.payload.text }));
const nudge = (command: string) =>
  `${command} only works in my private chat. Open <a href="https://t.me/office_test_bot">@office_test_bot</a>, press Start, then send ${command} there.\n\nHere in the group: /today, /stats, /stats month, /history, /test, /help.`;

// A command the bot does not own is probably meant for another bot in the group.
it.each(['/poll', '/vote', '/settings'])('%s in the office group stays unanswered', async (command) => {
  const h = harness();
  await h.updates.handleUpdate(h.event.command(command, groupId, 11), now);
  expect(sent(h)).toEqual([]);
});

it.each(['/start', '/flipper', '/schedule', '/cancel', '/admin'])('%s in the office group points to the private chat', async (command) => {
  const h = harness();
  await h.updates.handleUpdate(h.event.command(command, groupId, 11), now);
  expect(sent(h)).toEqual([{ chat: groupId, text: nudge(command) }]);
});
