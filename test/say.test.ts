import { expect, it } from 'vitest';
import { at, harness } from './helpers/harness.js';
import { groupId } from './fixtures/telegram-updates.js';

const now = at('09:30');
const sent = (h: ReturnType<typeof harness>) => h.calls('sendMessage').map(c => ({ chat: c.payload.chat_id, text: c.payload.text }));
function setup() {
  const h = harness();
  h.mock.members.set(11, 'administrator'); h.mock.members.set(22, 'member');
  return h;
}

it.each(['/admin say', '/admin say   ', '/admin say @alice'])('%s answers with the usage line and posts nothing', async (text) => {
  const h = setup();
  await h.updates.handleUpdate(h.event.command(text, 11, 11), now);
  expect(sent(h)).toEqual([{ chat: 11, text: 'Usage: /admin say <text> or /admin say @username <text>' }]);
});

it('/admin say posts to the office group and tells the admin', async () => {
  const h = setup();
  await h.updates.handleUpdate(h.event.command('/admin say Lift is broken today', 11, 11), now);
  expect(sent(h)).toEqual([
    { chat: groupId, text: 'Lift is broken today' },
    { chat: 11, text: 'Sent to the office group.' },
  ]);
});

it('a rejected group post is reported to the admin instead of being confirmed', async () => {
  const h = setup();
  h.mock.failures.set('sendMessage', { code: 403 });
  await h.updates.handleUpdate(h.event.command('/admin say Lift is broken today', 11, 11), now);
  expect(sent(h)).toEqual([
    { chat: groupId, text: 'Lift is broken today' },
    { chat: 11, text: 'Telegram rejected that message. Nothing was posted.' },
  ]);
});

it('/admin say @username writes privately to a member the bot has already seen', async () => {
  const h = setup();
  await h.updates.handleUpdate(h.event.command('/start', 22, 22, 'alice'), now);
  await h.updates.handleUpdate(h.event.command('/admin say @Alice Your badge is ready', 11, 11), now);
  expect(sent(h).slice(-2)).toEqual([
    { chat: 22, text: 'Your badge is ready' },
    { chat: 11, text: 'Sent to @Alice.' },
  ]);
});

it('an unknown username is nudged in the office group instead', async () => {
  const h = setup();
  await h.updates.handleUpdate(h.event.command('/admin say @ghost Your badge is ready', 11, 11), now);
  expect(sent(h)).toEqual([
    { chat: groupId, text: "⚠️ I can't reach @ghost privately.\n\n@ghost, please open @office_test_bot and press Start so I can write to you directly." },
    { chat: 11, text: "I don't know @ghost yet. I left a note in the office group instead." },
  ]);
});

it('someone who blocked the bot is nudged in the office group instead', async () => {
  const h = setup();
  await h.updates.handleUpdate(h.event.command('/start', 22, 22, 'alice'), now);
  h.mock.blocked.add(22);
  await h.updates.handleUpdate(h.event.command('/admin say @alice Your badge is ready', 11, 11), now);
  expect(sent(h).slice(-3)).toEqual([
    { chat: 22, text: 'Your badge is ready' },
    { chat: groupId, text: "⚠️ I can't reach @alice privately.\n\n@alice, please open @office_test_bot and press Start so I can write to you directly." },
    { chat: 11, text: "@alice has not started a private chat with me. I left a note in the office group instead." },
  ]);
});

it('refuses to write to somebody who is no longer in the office group', async () => {
  const h = setup();
  await h.updates.handleUpdate(h.event.command('/start', 22, 22, 'alice'), now);
  h.mock.members.set(22, 'left');
  await h.updates.handleUpdate(h.event.command('/admin say @alice Your badge is ready', 11, 11), now);
  expect(sent(h)).toEqual([
    { chat: 22, text: expect.stringContaining("You're ready to receive a private reminder") },
    { chat: 11, text: '@alice is not in the office group.' },
  ]);
});

// People who signed up long before this command existed have never sent the bot a private
// message, so the sign-up records are the second place a username can come from.
it('/admin say @username reaches somebody known only from a sign-up press', async () => {
  const h = setup();
  await h.scheduler.tick(at('09:00'));
  h.register(22);
  await h.updates.handleUpdate(h.event.press('2026-09-30', 'checkin', 22, h.day().signup!.messageId!, undefined, undefined, 'alice'), now);
  await h.updates.handleUpdate(h.event.command('/admin say @alice Your badge is ready', 11, 11), now);
  expect(sent(h).slice(-2)).toEqual([
    { chat: 22, text: 'Your badge is ready' },
    { chat: 11, text: 'Sent to @alice.' },
  ]);
});

it('a non-admin cannot use /admin say', async () => {
  const h = setup();
  await h.updates.handleUpdate(h.event.command('/admin say Lift is broken today', 22, 22), now);
  expect(sent(h)).toEqual([{ chat: 22, text: 'Not available.' }]);
});
