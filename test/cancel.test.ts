import { expect, it } from 'vitest';
import type { Update } from 'grammy/types';
import { at, harness } from './helpers/harness.js';

const now = at('09:30');
const sent = (h: ReturnType<typeof harness>) => h.calls('sendMessage').map(c => ({ chat: c.payload.chat_id, text: c.payload.text, markup: c.payload.reply_markup }));
const last = (h: ReturnType<typeof harness>) => sent(h).at(-1);
const answer = (h: ReturnType<typeof harness>) => h.calls('answerCallbackQuery').at(-1)!.payload.text;
const PROMPT = 'How are you listed in Flipper? Send the name exactly as it appears there.';
const INVALID = "That doesn't look right. Send the name (1–64 characters, one line).";
const CANCEL = { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'cancel' }]] };
const BACK = { inline_keyboard: [[{ text: 'Back', callback_data: 'admin:back' }, { text: '❌ Cancel', callback_data: 'cancel' }]] };
const REMOVE = { remove_keyboard: true };
// A plain private text message: the command fixture without the bot_command entity.
function text(h: ReturnType<typeof harness>, value: string, actor = 11): Update {
  const update = h.event.command(value, actor, actor);
  return { ...update, message: { ...update.message!, entities: undefined } };
}

it('the Flipper prompt carries a Cancel button, and the button stops the dialog', async () => {
  const h = harness();
  await h.updates.handleUpdate(h.event.dm('/flipper'), now);
  expect(last(h)).toEqual({ chat: 11, text: PROMPT, markup: CANCEL });
  await h.updates.handleUpdate(h.event.callback('cancel', 11, 5, 11), now);
  expect(answer(h)).toBe('Cancelled');
  expect(last(h)).toEqual({ chat: 11, text: 'Cancelled.', markup: REMOVE });
  expect(h.store.get('conv:11')).toBeNull();
  await h.updates.handleUpdate(text(h, 'Late Name'), now);
  expect(h.flipperNames(11)).toBeUndefined();
});

it('a rejected name keeps the Cancel button on the newest message', async () => {
  const h = harness();
  await h.updates.handleUpdate(h.event.dm('/flipper'), now);
  await h.updates.handleUpdate(text(h, '   '), now);
  expect(last(h)).toEqual({ chat: 11, text: INVALID, markup: CANCEL });
});

it('the admin name step offers Back and Cancel, and Cancel ends the whole dialog', async () => {
  const h = harness();
  h.mock.members.set(11, 'administrator'); h.mock.members.set(22, 'member');
  await h.updates.handleUpdate(h.event.dm('/admin flipper'), now);
  await h.updates.handleUpdate(h.event.usersShared(11, 22), now);
  expect(last(h)).toEqual({ chat: 11, text: 'Flipper name for Person 22?', markup: BACK });
  await h.updates.handleUpdate(h.event.callback('cancel', 11, 5, 11), now);
  expect(last(h)).toEqual({ chat: 11, text: 'Cancelled.', markup: REMOVE });
  expect(h.store.get('conv:11')).toBeNull();
  await h.updates.handleUpdate(text(h, 'Anna K'), now);
  expect(h.flipperNames(22)).toBeUndefined();
});

it('/flipper during a live admin dialog closes it, then asks with a Cancel button', async () => {
  const h = harness();
  h.mock.members.set(11, 'administrator'); h.mock.members.set(22, 'member');
  await h.updates.handleUpdate(h.event.dm('/admin flipper'), now);
  await h.updates.handleUpdate(h.event.dm('/flipper'), now);
  expect(sent(h).slice(-2)).toEqual([
    { chat: 11, text: 'The Flipper dialog for other people is closed.', markup: REMOVE },
    { chat: 11, text: PROMPT, markup: CANCEL },
  ]);
  await h.updates.handleUpdate(text(h, 'Own Name'), now);
  expect(h.flipperNames(11)).toBe('Own Name');
  expect(h.flipperNames(22)).toBeUndefined();
});

it('Cancel with nothing running answers the tap and says nothing else', async () => {
  const h = harness();
  await h.updates.handleUpdate(h.event.callback('cancel', 11, 5, 11), now);
  expect(answer(h)).toBe('Nothing to cancel.');
  expect(sent(h)).toEqual([]);
});
