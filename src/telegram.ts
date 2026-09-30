import { Api, GrammyError, type Transformer } from 'grammy';
import type { InlineKeyboardMarkup, Poll, Update } from 'grammy/types';
import type { DayKey, PollKind, PollSnapshot, SendResult } from './types.js';

export function snapshot(poll: Poll, messageId: number): PollSnapshot {
  return { id: poll.id, messageId, closed: poll.is_closed,
    optionCounts: poll.options.map(o => o.voter_count), totalVoters: poll.total_voter_count };
}
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
        allowed_updates: ['message', 'poll', 'poll_answer', 'callback_query'] });
    },
    sendPoll(chatId: number, kind: PollKind, day: DayKey, closesAt: Date): Promise<SendResult<PollSnapshot>> {
      const question = kind === 'request' ? 'Who needs to be checked in today?' : "Who's coming to the office and can help?";
      const choices = kind === 'request' ? ['I do', 'Not today'] : ["I'm coming and can help", "I can't help today"];
      return send(async () => {
        const message = await api.sendPoll(chatId, `${question} (${day})`, choices.map(text => ({ text })), {
          is_anonymous: false, allows_multiple_answers: false, allows_revoting: true, type: 'regular',
          close_date: Math.floor(closesAt.getTime() / 1000),
        });
        return snapshot(message.poll, message.message_id);
      });
    },
    async stopPoll(chatId: number, messageId: number): Promise<PollSnapshot | null> {
      try { return snapshot(await api.stopPoll(chatId, messageId), messageId); }
      catch (error) {
        if (error instanceof GrammyError && error.description.toLowerCase().includes('poll has already been closed')) return null;
        throw Error('Unable to retrieve closed poll');
      }
    },
    sendMessage(chatId: number, text: string, keyboard?: InlineKeyboardMarkup): Promise<SendResult<number>> {
      return send(async () => (await api.sendMessage(chatId, text, {
        parse_mode: 'HTML', reply_markup: keyboard, link_preview_options: { is_disabled: true },
      })).message_id);
    },
    async editMessage(chatId: number, messageId: number, text: string, keyboard?: InlineKeyboardMarkup): Promise<void> {
      try { await api.editMessageText(chatId, messageId, text, { parse_mode: 'HTML', reply_markup: keyboard ?? { inline_keyboard: [] }, link_preview_options: { is_disabled: true } }); }
      catch (error) {
        if (error instanceof GrammyError && error.description.includes('message is not modified')) return;
        throw Error('Unable to update assignment message');
      }
    },
    async answerCallback(id: string, text: string): Promise<void> {
      try { await api.answerCallbackQuery(id, { text }); } catch { /* Expired callback answers do not change committed state. */ }
    },
  };
}
export type TelegramPort = ReturnType<typeof createTelegram>;
