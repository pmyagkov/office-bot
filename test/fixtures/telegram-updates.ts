import type { Update, User } from 'grammy/types';
export const groupId = -1001234567890;
export const user = (id: number, name = `Person ${id}`): User => ({ id, first_name: name, is_bot: false });
export function events() {
  let next = 1;
  return {
    vote(pollId: string, id: number, option: number | null, name?: string): Update {
      return { update_id: next++, poll_answer: { poll_id: pollId, user: user(id, name), option_ids: option === null ? [] : [option], option_persistent_ids: option === null ? [] : [String(option)] } };
    },
    command(text: string, chatId = groupId, actor = 11): Update {
      return { update_id: next++, message: { message_id: next, date: 1790751600, chat: chatId < 0 ? { id: chatId, type: 'supergroup', title: 'Office' } : { id: chatId, type: 'private', first_name: 'Person' }, from: user(actor), text, entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] } };
    },
    click(day: string, actor: number, messageId: number, chatId = groupId): Update {
      return { update_id: next++, callback_query: { id: `callback-${next}`, from: user(actor), chat_instance: 'test', data: `done:${day}`, message: { message_id: messageId, date: 1790755200, chat: { id: chatId, type: 'supergroup', title: 'Office' }, text: 'Assignment' } } };
    },
    callback(data: string, actor: number, messageId: number, chatId: number): Update {
      return { update_id: next++, callback_query: { id: `callback-${next}`, from: user(actor), chat_instance: 'test', data, message: { message_id: messageId, date: 1790755200, chat: chatId < 0 ? { id: chatId, type: 'supergroup', title: 'Office' } : { id: chatId, type: 'private', first_name: 'Person' }, text: 'Sign-up' } } };
    },
    press(day: string, action: 'checkin' | 'duty' | 'discard', actor: number, messageId: number, name?: string, chatId = groupId): Update {
      return { update_id: next++, callback_query: { id: `callback-${next}`, from: user(actor, name), chat_instance: 'test', data: `signup:${day}:${action}`, message: { message_id: messageId, date: 1790755200, chat: { id: chatId, type: 'supergroup', title: 'Office' }, text: 'Sign-up' } } };
    },
    usersShared(actor: number, targetId: number, requestId = 1, name?: string): Update {
      return { update_id: next++, message: { message_id: next, date: 1790751600, chat: { id: actor, type: 'private', first_name: 'Person' }, from: user(actor), users_shared: { request_id: requestId, users: [{ user_id: targetId, first_name: name ?? `Person ${targetId}` }] } } };
    },
  };
}
