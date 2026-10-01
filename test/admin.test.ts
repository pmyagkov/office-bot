import { expect, it } from 'vitest';
import type { Update } from 'grammy/types';
import { createUpdates } from '../src/updates.js';
import { at, harness, schedule } from './helpers/harness.js';
import { groupId, user } from './fixtures/telegram-updates.js';

const now = at('09:30');
const PICKER = { keyboard: [[{ text: 'Choose person', request_users: { request_id: 1, user_is_bot: false, max_quantity: 1, request_name: true, request_username: true } }, { text: 'Finish' }]], resize_keyboard: true };
const BACK = { inline_keyboard: [[{ text: 'Back', callback_data: 'admin:back' }]] };
const sent = (h: ReturnType<typeof harness>) => h.calls('sendMessage').map(c => ({ chat: c.payload.chat_id, text: c.payload.text, markup: c.payload.reply_markup }));
const last = (h: ReturnType<typeof harness>) => sent(h).at(-1);
function setup() {
  const h = harness();
  h.mock.members.set(11, 'administrator'); h.mock.members.set(22, 'member'); h.mock.members.set(33, 'member');
  return h;
}
// A plain private text message: the command fixture without the bot_command entity.
function text(h: ReturnType<typeof harness>, value: string, actor = 11): Update {
  const update = h.event.command(value, actor, actor);
  return { ...update, message: { ...update.message!, entities: undefined } };
}
async function startDialog(h: ReturnType<typeof harness>) { await h.updates.handleUpdate(h.event.command('/admin flipper', 11, 11), now); }

it('/admin lists the command for an admin and refuses a member', async () => {
  const h = setup();
  await h.updates.handleUpdate(h.event.command('/admin', 11, 11), now);
  await h.updates.handleUpdate(h.event.command('/admin', 22, 22), now);
  expect(sent(h)).toEqual([
    { chat: 11, text: 'Admin commands:\n/admin flipper — set Flipper names', markup: undefined },
    { chat: 22, text: 'Not available.', markup: undefined },
  ]);
  expect(h.store.get('conv:22')).toBeUndefined();
});

it('/admin flipper loops over people and Finish reports the count', async () => {
  const h = setup();
  await startDialog(h);
  expect(last(h)).toEqual({ chat: 11, text: 'Choose a person.', markup: PICKER });
  expect(h.store.get('conv:11')).toEqual({ kind: 'admin_person', saved: 0 });
  await h.updates.handleUpdate(h.event.usersShared(11, 22), now);
  expect(last(h)).toEqual({ chat: 11, text: 'Flipper name for Person 22?', markup: BACK });
  await h.updates.handleUpdate(text(h, '  Anna K '), now);
  expect(last(h)).toEqual({ chat: 11, text: 'Saved: Anna K for Person 22.', markup: PICKER });
  expect(h.flipperNames(22)).toBe('Anna K');
  expect(h.store.get('flipper:22')).toMatchObject({ setBy: 11 });
  expect(h.store.get('conv:11')).toEqual({ kind: 'admin_person', saved: 1 });
  await h.updates.handleUpdate(h.event.usersShared(11, 33, 1, 'Bob'), now);
  expect(last(h)?.text).toBe('Flipper name for Bob?');
  await h.updates.handleUpdate(text(h, 'Bob B'), now);
  expect(h.flipperNames(33)).toBe('Bob B');
  await h.updates.handleUpdate(text(h, 'Finish'), now);
  expect(last(h)).toEqual({ chat: 11, text: 'Done, saved 2 names.', markup: { remove_keyboard: true } });
  expect(h.store.get('conv:11')).toBeNull();
});

it('Back returns to the picker without saving; the current name is shown and overwritten', async () => {
  const h = setup(); h.register(22, 'Old <Name>');
  await startDialog(h);
  await h.updates.handleUpdate(h.event.usersShared(11, 22), now);
  expect(last(h)).toEqual({ chat: 11, text: 'Flipper name for Person 22?\nCurrent: Old &lt;Name&gt;', markup: BACK });
  const back = h.event.callback('admin:back', 11, 5, 11);
  await h.updates.handleUpdate(back, now);
  expect(h.calls('answerCallbackQuery').at(-1)!.payload.callback_query_id).toBe(back.callback_query!.id);
  expect(last(h)).toEqual({ chat: 11, text: 'Choose a person.', markup: PICKER });
  expect(h.store.get('conv:11')).toEqual({ kind: 'admin_person', saved: 0 });
  expect(h.flipperNames(22)).toBe('Old <Name>');
  await h.updates.handleUpdate(h.event.usersShared(11, 22), now);
  await h.updates.handleUpdate(text(h, 'New Name'), now);
  expect(h.flipperNames(22)).toBe('New Name');
});

it('Back outside the name step or from a non-admin is not available', async () => {
  const h = setup();
  await startDialog(h);
  const stale = h.event.callback('admin:back', 11, 5, 11);
  await h.updates.handleUpdate(stale, now);
  expect(h.calls('answerCallbackQuery').at(-1)!.payload).toMatchObject({ text: 'Not available.' });
  expect(h.store.get('conv:11')).toEqual({ kind: 'admin_person', saved: 0 });
  await h.updates.handleUpdate(h.event.usersShared(11, 22), now);
  const forged = h.event.callback('admin:back', 22, 5, 22);
  await h.updates.handleUpdate(forged, now);
  expect(h.calls('answerCallbackQuery').at(-1)!.payload).toMatchObject({ text: 'Not available.' });
  expect(h.store.get('conv:11')).toMatchObject({ kind: 'admin_name' });
});

it('the word "Finish" typed while a name is awaited is saved as the name', async () => {
  const h = setup();
  await startDialog(h);
  await h.updates.handleUpdate(h.event.usersShared(11, 22), now);
  await h.updates.handleUpdate(text(h, 'Finish'), now);
  expect(h.flipperNames(22)).toBe('Finish');
  expect(last(h)?.text).toBe('Saved: Finish for Person 22.');
  expect(h.store.get('conv:11')).toEqual({ kind: 'admin_person', saved: 1 });
});

it('an invalid name re-asks and saves nothing', async () => {
  const h = setup();
  await startDialog(h);
  await h.updates.handleUpdate(h.event.usersShared(11, 22), now);
  for (const bad of ['   ', 'x'.repeat(65), 'two\nlines']) await h.updates.handleUpdate(text(h, bad), now);
  expect(sent(h).slice(-3).map(s => s.text)).toEqual(Array(3).fill("That doesn't look right. Send the name (1–64 characters, one line)."));
  expect(h.flipperNames(22)).toBeUndefined();
  expect(h.store.get('conv:11')).toMatchObject({ kind: 'admin_name' });
});

it('a non-member pick is rejected and nothing is saved', async () => {
  const h = setup(); h.mock.members.set(44, 'left'); h.mock.members.set(55, 'kicked');
  await startDialog(h);
  for (const id of [44, 55, 66]) {
    await h.updates.handleUpdate(h.event.usersShared(11, id, 1, `<N${id}>`), now);
    expect(last(h)?.text).toBe(`&lt;N${id}&gt; is not in the office group.`);
  }
  await h.updates.handleUpdate(text(h, 'Sneaky'), now);
  expect(h.store.get('conv:11')).toEqual({ kind: 'admin_person', saved: 0 });
  for (const id of [44, 55, 66]) expect(h.flipperNames(id)).toBeUndefined();
});

it('picking yourself is allowed', async () => {
  const h = setup();
  await startDialog(h);
  await h.updates.handleUpdate(h.event.usersShared(11, 11), now);
  await h.updates.handleUpdate(text(h, 'Admin Anna'), now);
  expect(h.flipperNames(11)).toBe('Admin Anna');
});

it('an admin who loses admin rights mid-dialog cannot save', async () => {
  const h = setup();
  await startDialog(h);
  await h.updates.handleUpdate(h.event.usersShared(11, 22), now);
  h.mock.members.set(11, 'member');
  await h.updates.handleUpdate(text(h, 'Anna K'), now);
  expect(last(h)).toEqual({ chat: 11, text: 'Not available.', markup: { remove_keyboard: true } });
  expect(h.flipperNames(22)).toBeUndefined();
  expect(h.store.get('conv:11')).toBeNull();
});

it('rights are checked again on every message, not cached', async () => {
  const h = setup();
  await startDialog(h);
  await h.updates.handleUpdate(h.event.usersShared(11, 22), now);
  await h.updates.handleUpdate(text(h, 'Anna K'), now);
  h.mock.members.set(11, 'member');
  await h.updates.handleUpdate(h.event.usersShared(11, 33), now);
  expect(last(h)?.text).toBe('Not available.');
  expect(h.store.get('conv:11')).toBeNull();
  expect(h.flipperNames(22)).toBe('Anna K');
});

it('a restart mid-dialog resumes at the name step', async () => {
  const h = setup();
  await startDialog(h);
  await h.updates.handleUpdate(h.event.usersShared(11, 22), now);
  const restarted = createUpdates({ store: h.store, telegram: h.telegram, delivery: h.delivery, schedule, chatId: groupId, username: 'office_test_bot', flipperNames: h.flipperNames });
  await restarted.handleUpdate(text(h, 'Anna K'), now);
  expect(h.flipperNames(22)).toBe('Anna K');
  expect(h.store.get('conv:11')).toEqual({ kind: 'admin_person', saved: 1 });
});

it('a non-admin cannot reach admin states even with a forged users_shared', async () => {
  const h = setup();
  await h.updates.handleUpdate(h.event.usersShared(22, 33), now);
  await h.updates.handleUpdate(text(h, 'Anna K', 22), now);
  await h.updates.handleUpdate(h.event.command('/admin flipper', 22, 22), now);
  h.store.set('conv:22', { kind: 'admin_name', target: { id: 33, name: 'Person 33' }, saved: 0 });
  await h.updates.handleUpdate(text(h, 'Forged', 22), now);
  expect(h.flipperNames(33)).toBeUndefined();
  expect(sent(h).map(s => s.text)).toEqual(['Not available.', 'Not available.']);
  expect(h.store.get('conv:22')).toBeNull();
});

it('a failed membership lookup keeps the update cursor in place', async () => {
  const h = setup();
  await startDialog(h);
  const before = h.store.get('offset');
  h.mock.failures.set('getChatMember', { code: 500 });
  await expect(h.updates.handleUpdate(h.event.usersShared(11, 22), now)).rejects.toThrow();
  expect(h.store.get('offset')).toBe(before);
  expect(h.store.get('conv:11')).toEqual({ kind: 'admin_person', saved: 0 });
});

it('the self flow and cancel still work next to the admin dialog', async () => {
  const h = setup();
  await startDialog(h);
  await h.updates.handleUpdate(h.event.command('/cancel', 11, 11), now);
  expect(last(h)).toEqual({ chat: 11, text: 'Cancelled.', markup: { remove_keyboard: true } });
  expect(h.store.get('conv:11')).toBeNull();
  await h.updates.handleUpdate(h.event.command('/flipper', 11, 11), now);
  await h.updates.handleUpdate(text(h, 'Own Name'), now);
  expect(h.flipperNames(11)).toBe('Own Name');
});

it('ignores admin input from bots and from group chats', async () => {
  const h = setup();
  const bot = h.event.command('/admin', 13, 13);
  await h.updates.handleUpdate({ ...bot, message: { ...bot.message!, from: { ...user(13), is_bot: true } } }, now);
  await h.updates.handleUpdate(h.event.command('/admin', groupId, 11), now);
  expect(sent(h)).toEqual([]);
});
