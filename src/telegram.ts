import { Api, GrammyError, type Transformer } from 'grammy';
import type { ChatMember, InlineKeyboardMarkup, ReplyKeyboardMarkup, ReplyKeyboardRemove, Update } from 'grammy/types';
import type { SendResult } from './types.js';

export async function send<T>(action: () => Promise<T>): Promise<SendResult<T>> {
  try { return { kind: 'sent', value: await action() }; }
  catch (error) {
    if (error instanceof GrammyError && error.error_code >= 400 && error.error_code < 500) {
      return { kind: 'rejected', code: error.error_code,
        ...(error.parameters.retry_after ? { retryAfter: error.parameters.retry_after } : {}) };
    }
    return { kind: 'uncertain' };
  }
}
export function createTelegram(token: string, options: { apiRoot?: string; transformer?: Transformer } = {}) {
  const api = new Api(token, { apiRoot: options.apiRoot, timeoutSeconds: 25 });
  if (options.transformer) api.config.use(options.transformer);
  return {
    api,
    getUpdates(offset: number, timeoutSeconds: number): Promise<Update[]> {
      return api.getUpdates({ offset, timeout: timeoutSeconds, limit: 100,
        allowed_updates: ['message', 'callback_query'] });
    },
    sendMessage(chatId: number, text: string, markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove): Promise<SendResult<number>> {
      return send(async () => (await api.sendMessage(chatId, text, {
        parse_mode: 'HTML', reply_markup: markup, link_preview_options: { is_disabled: true },
      })).message_id);
    },
    async getMemberStatus(chatId: number, userId: number): Promise<ChatMember['status'] | null> {
      try { return (await api.getChatMember(chatId, userId)).status; }
      catch (error) {
        if (error instanceof GrammyError && error.error_code === 400) {
          const description = error.description.toLowerCase();
          if (description.includes('user not found') || description.includes('member not found')) return null;
        }
        throw Error('Unable to read chat member');
      }
    },
    async editMessage(chatId: number, messageId: number, text: string, keyboard?: InlineKeyboardMarkup): Promise<void> {
      try { await api.editMessageText(chatId, messageId, text, { parse_mode: 'HTML', reply_markup: keyboard ?? { inline_keyboard: [] }, link_preview_options: { is_disabled: true } }); }
      catch (error) {
        if (error instanceof GrammyError && error.description.includes('message is not modified')) return;
        throw Error('Unable to update assignment message');
      }
    },
    async answerCallback(id: string, text: string, url?: string): Promise<void> {
      try { await api.answerCallbackQuery(id, { text, ...(url ? { url } : {}) }); } catch { /* Expired callback answers do not change committed state. */ }
    },
  };
}
export type TelegramPort = ReturnType<typeof createTelegram>;
