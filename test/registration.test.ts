import { expect, it } from 'vitest';
import type { Update } from 'grammy/types';
import { createUpdates } from '../src/updates.js';
import { at, harness, schedule } from './helpers/harness.js';
import { groupId, user } from './fixtures/telegram-updates.js';

const PROMPT = 'How are you listed in Flipper? Send the name exactly as it appears there.';
const INVALID = "That doesn't look right. Send the name (1–64 characters, one line).";
const now = at('09:30');
const sent = (h: ReturnType<typeof harness>) => h.calls('sendMessage').map(c => ({ chat: c.payload.chat_id, text: c.payload.text }));
// A plain private text message: the command fixture without the bot_command entity.
function text(h: ReturnType<typeof harness>, value: string, actor = 11): Update {
  const update = h.event.command(value, actor, actor);
  return { ...update, message: { ...update.message!, entities: undefined } };
}

it('/start flipper asks for the name and stores the conversation', async () => {
  const h = harness();
  await h.updates.handleUpdate(h.event.command('/start flipper', 11, 11), now);
  expect(sent(h)).toEqual([{ chat: 11, text: PROMPT }]);
  expect(h.store.get('conv:11')).toEqual({ kind: 'self_name', at: now.toISOString() });
  expect(h.store.get('user:11')).toMatchObject({ id: 11 });
});

it('text after the prompt saves the name and confirms', async () => {
  const h = harness(); await h.scheduler.tick(at('09:00'));
  await h.updates.handleUpdate(h.event.command('/start flipper', 11, 11), now);
  await h.updates.handleUpdate(text(h, '  Anna <K> & Co  '), now);
  expect(sent(h).slice(-2)).toEqual([{ chat: 11, text: PROMPT },{ chat: 11, text: 'Saved: Anna &lt;K&gt; &amp; Co. Go back to the group and press Check me in.' }]);
  expect(h.flipperNames(11)).toBe('Anna <K> & Co');
  expect(h.store.get('conv:11')).toBeNull();
  expect(h.press('checkin', 11)).toEqual({ text: "You're signed up for a check-in" });
  expect(h.day().signup!.choices['11']).toMatchObject({ choice: 'checkin' });
});

it('invalid text re-asks and saves nothing', async () => {
  const h = harness();
  await h.updates.handleUpdate(h.event.command('/start flipper', 11, 11), now);
  for (const bad of ['   ', 'x'.repeat(65), 'two\nlines']) await h.updates.handleUpdate(text(h, bad), now);
  expect(sent(h).slice(1)).toEqual([{ chat: 11, text: INVALID }, { chat: 11, text: INVALID }, { chat: 11, text: INVALID }]);
  expect(h.flipperNames(11)).toBeUndefined();
  expect(h.store.get('conv:11')).toEqual({ kind: 'self_name', at: now.toISOString() });
});

it('/flipper changes an existing name', async () => {
  const h = harness(); h.register(11, 'Old Name');
  await h.updates.handleUpdate(h.event.command('/flipper', 11, 11), now);
  await h.updates.handleUpdate(text(h, 'New Name'), now);
  expect(sent(h)[0]).toEqual({ chat: 11, text: PROMPT });
  expect(h.flipperNames(11)).toBe('New Name');
});

it('/cancel clears the conversation', async () => {
  const h = harness();
  await h.updates.handleUpdate(h.event.command('/flipper', 11, 11), now);
  await h.updates.handleUpdate(h.event.command('/cancel', 11, 11), now);
  expect(h.store.get('conv:11')).toBeNull();
  await h.updates.handleUpdate(text(h, 'Late Name'), now);
  expect(h.flipperNames(11)).toBeUndefined();
});

it('survives a restart between prompt and answer', async () => {
  const h = harness();
  await h.updates.handleUpdate(h.event.command('/flipper', 11, 11), now);
  const restarted = createUpdates({ store: h.store, telegram: h.telegram, delivery: h.delivery, schedule, chatId: groupId, username: 'office_test_bot', flipperNames: h.flipperNames });
  await restarted.handleUpdate(text(h, 'Anna K'), now);
  expect(h.flipperNames(11)).toBe('Anna K');
});

it('ignores and clears a conversation older than one hour', async () => {
  const h = harness();
  await h.updates.handleUpdate(h.event.command('/flipper', 11, 11), now);
  h.store.set('conv:12', { kind: 'self_name' });
  await h.updates.handleUpdate(text(h, 'thanks'), new Date(now.getTime() + 3_600_000));
  await h.updates.handleUpdate(text(h, 'hello', 12), now);
  expect(sent(h)).toEqual([{ chat: 11, text: PROMPT }]);
  expect(h.flipperNames(11)).toBeUndefined(); expect(h.flipperNames(12)).toBeUndefined();
  expect(h.store.get('conv:11')).toBeNull(); expect(h.store.get('conv:12')).toBeNull();
});

it('keeps a conversation younger than one hour, and /flipper after a stale one starts afresh', async () => {
  const h = harness(); const later = new Date(now.getTime() + 3_599_000);
  await h.updates.handleUpdate(h.event.command('/flipper', 11, 11), now);
  await h.updates.handleUpdate(text(h, 'Anna K'), later);
  expect(h.flipperNames(11)).toBe('Anna K');
  h.store.set('conv:11', { kind: 'self_name', at: at('07:00').toISOString() });
  await h.updates.handleUpdate(h.event.command('/flipper', 11, 11), now);
  expect(h.store.get('conv:11')).toEqual({ kind: 'self_name', at: now.toISOString() });
  await h.updates.handleUpdate(text(h, 'Anna B'), now);
  expect(h.flipperNames(11)).toBe('Anna B');
  expect(sent(h).map(s => s.text)).toEqual([PROMPT, expect.stringContaining('Saved: Anna K'), PROMPT, expect.stringContaining('Saved: Anna B')]);
});

it('ignores private text without a conversation and commands in other chats', async () => {
  const h = harness();
  await h.updates.handleUpdate(text(h, 'Anna K'), now);
  await h.updates.handleUpdate(h.event.command('/flipper', groupId, 11), now);
  await h.updates.handleUpdate(h.event.command('/start flipper', -1009999999999, 11), now);
  await h.updates.handleUpdate(h.event.command('/flipper', 12, 11), now);
  await h.updates.handleUpdate(h.event.command('/flipper@other_bot', 11, 11), now);
  const bot = h.event.command('/flipper', 13, 13);
  await h.updates.handleUpdate({ ...bot, message: { ...bot.message!, from: { ...user(13), is_bot: true } } }, now);
  expect(sent(h)).toEqual([]);
  expect(h.flipperNames(11)).toBeUndefined();
  expect(h.store.get('conv:11')).toBeUndefined();
  expect(h.store.get('conv:13')).toBeUndefined();
});

it('plain /start still replies with the reminder copy', async () => {
  const h = harness();
  await h.updates.handleUpdate(h.event.command('/start', 11, 11), now);
  expect(sent(h)).toHaveLength(1);
  expect(String(sent(h)[0].text)).toContain("You're ready to receive a private reminder at 14:00");
  expect(h.store.get('user:11')).toMatchObject({ id: 11 });
  expect(h.store.get('conv:11')).toBeUndefined();
});

it('answers a callback with unrecognised data so the spinner stops', async () => {
  const h = harness();
  const update = h.event.callback('bogus:data', 11, 5, groupId);
  await h.updates.handleUpdate(update, now);
  expect(h.calls('answerCallbackQuery')).toEqual([{ method: 'answerCallbackQuery', payload: { callback_query_id: update.callback_query!.id, text: 'Not available.' } }]);
});

it('sends a reply job markup with the last page only', async () => {
  const h = harness(); const markup = { remove_keyboard: true as const };
  h.store.set('reply:r1', { key: 'r1', chatId: 11, pages: ['one', 'two'], markup, done: false });
  await h.updates.flushReplies(now);
  const calls = h.calls('sendMessage').map(c => ({ text: c.payload.text, markup: c.payload.reply_markup }));
  expect(calls).toEqual([{ text: 'one', markup: undefined }, { text: 'two', markup }]);
});
