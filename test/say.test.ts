import { expect, it } from 'vitest';
import { at, harness } from './helpers/harness.js';
import { groupId } from './fixtures/telegram-updates.js';

const now = at('09:30');
const sent = (h: ReturnType<typeof harness>) => h.calls('sendMessage').map(c => ({ chat: c.payload.chat_id, text: c.payload.text }));
function setup() {
  const h = harness();
  h.mock.members.set(11, 'administrator'); h.mock.members.set(22, 'member');
  h.mock.usernames.set(22, 'alice');
  return h;
}

it.each(['/admin say', '/admin say   ', '/admin say @alice'])('%s answers with the usage line and posts nothing', async (text) => {
  const h = setup();
  await h.updates.handleUpdate(h.event.command(text, 11, 11), now);
  expect(sent(h)).toEqual([{ chat: 11, text: 'Usage: /admin say &lt;text&gt; or /admin say @username &lt;text&gt;' }]);
});

it('/admin say posts to the office group and tells the admin', async () => {
  const h = setup();
  await h.updates.handleUpdate(h.event.command('/admin say Lift is broken today', 11, 11), now);
  expect(sent(h)).toEqual([
    { chat: groupId, text: 'Lift is broken today' },
    { chat: 11, text: 'Sent to the office group.' },
  ]);
});

// An announcement worth sending through the bot usually has more than one line.
it('/admin say posts a message with several lines', async () => {
  const h = setup();
  await h.updates.handleUpdate(h.event.command('/admin say Lift is broken.\nUse the stairs.', 11, 11), now);
  expect(sent(h)).toEqual([
    { chat: groupId, text: 'Lift is broken.\nUse the stairs.' },
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

// Unlike /flipper or /cancel, say does not end the Flipper dialog, so it must not take its
// keyboard away either.
it('/admin say in the middle of the Flipper dialog leaves the picker alone', async () => {
  const h = setup();
  await h.updates.handleUpdate(h.event.command('/admin flipper', 11, 11), now);
  await h.updates.handleUpdate(h.event.command('/admin say Lift is broken today', 11, 11), now);
  const ack = h.calls('sendMessage').at(-1)!.payload;
  expect(ack).toMatchObject({ chat_id: 11, text: 'Sent to the office group.' });
  expect(ack.reply_markup).toBeUndefined();
  expect(h.store.get('conv:11')).toMatchObject({ kind: 'admin_person' });
});

// Telegram usernames can be given up and taken over by somebody else, so a handle the bot
// last saw on a person who has since renamed must stop resolving to them.
it('a username its owner has given up is no longer resolved to them', async () => {
  const h = setup();
  await h.scheduler.tick(at('09:00'));
  h.register(22);
  await h.updates.handleUpdate(h.event.press('2026-09-30', 'checkin', 22, h.day().signup!.messageId!, undefined, undefined, 'alice'), now);
  await h.updates.handleUpdate(h.event.command('/start', 22, 22, 'bob'), now);
  await h.updates.handleUpdate(h.event.command('/admin say @alice Your badge is ready', 11, 11), now);
  expect(sent(h).filter(s => s.text === 'Your badge is ready')).toEqual([]);
  expect(sent(h).slice(-2)).toEqual([
    { chat: groupId, text: expect.stringContaining("I can't reach @alice privately") },
    { chat: 11, text: "I don't know @alice yet. I left a note in the office group instead." },
  ]);
});

// Every reply goes out with parse_mode HTML, and Telegram answers 400 for a tag it does not
// know — so the fixed copy must not contain a bare `<`. `mock.messages` only records what was
// accepted, unlike `calls`, which records the attempt.
it('the admin menu and the usage line are accepted by Telegram, not just attempted', async () => {
  const h = setup();
  await h.updates.handleUpdate(h.event.command('/admin', 11, 11), now);
  await h.updates.handleUpdate(h.event.command('/admin say', 11, 11), now);
  expect([...h.mock.messages.values()].map(payload => payload.text)).toEqual([
    expect.stringContaining('Admin commands:'),
    expect.stringContaining('Usage:'),
  ]);
});

// The index can only ever be as fresh as the last update the bot saw. The membership lookup
// the send needs anyway reports the handle the person has right now, so it has the last word.
it('a handle Telegram no longer reports for that person does not reach them', async () => {
  const h = setup();
  await h.updates.handleUpdate(h.event.command('/start', 22, 22, 'alice'), now);
  h.mock.usernames.set(22, 'bob');
  await h.updates.handleUpdate(h.event.command('/admin say @alice Your badge is ready', 11, 11), now);
  expect(sent(h).filter(s => s.text === 'Your badge is ready')).toEqual([]);
  expect(sent(h).at(-1)).toEqual({ chat: 11, text: "I don't know @alice yet. I left a note in the office group instead." });
});

it('a nudge the office group rejects is still reported to the admin', async () => {
  const h = setup();
  h.mock.blocked.add(groupId);
  await h.updates.handleUpdate(h.event.command('/admin say @ghost Your badge is ready', 11, 11), now);
  expect(sent(h).at(-1)).toEqual({ chat: 11, text: "I don't know @ghost yet. The office group rejected the note, too." });
});

it('a non-admin cannot use /admin say', async () => {
  const h = setup();
  await h.updates.handleUpdate(h.event.command('/admin say Lift is broken today', 22, 22), now);
  expect(sent(h)).toEqual([{ chat: 22, text: 'Not available.' }]);
});
