import { Api, GrammyError, type Transformer } from 'grammy';
import type { ChatMember, InlineKeyboardMarkup, ReplyKeyboardMarkup, ReplyKeyboardRemove, Update } from 'grammy/types';
import type { SendResult } from './types.js';

const PRIVATE_MENU = [
  { command: 'start', description: 'What I do and which commands exist' },
  { command: 'help', description: 'Show the command list' },
  { command: 'flipper', description: 'Set the name you are listed under in Flipper' },
  { command: 'schedule', description: 'Sign up for the next sign-up in advance' },
  { command: 'today', description: "Today's status" },
  { command: 'stats', description: "This week's confirmed check-ins" },
  { command: 'history', description: 'Recent confirmations' },
  { command: 'test', description: 'Interactive test run with separate statistics' },
];
// Empty on purpose: no command is answered in the group, so Telegram must not suggest one
// there. This scope wins over the default one, whatever BotFather was told.
const GROUP_MENU: { command: string; description: string }[] = [];

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
    // Scoped menus: what Telegram suggests in the group is exactly what works there.
    async publishCommands(): Promise<void> {
      await api.setMyCommands(PRIVATE_MENU, { scope: { type: 'all_private_chats' } });
      await api.setMyCommands(GROUP_MENU, { scope: { type: 'all_group_chats' } });
    },
    getMemberStatus(chatId: number, userId: number): Promise<ChatMember['status'] | null> {
      return this.getMember(chatId, userId).then(member => member?.status ?? null);
    },
    // The handle Telegram reports here is the one the person has now, which the username index
    // cannot know. `/admin say @name` uses it to make sure it is writing to the right person.
    async getMember(chatId: number, userId: number): Promise<{ status: ChatMember['status']; username?: string } | null> {
      try {
        const member = await api.getChatMember(chatId, userId);
        return { status: member.status, ...(member.user.username ? { username: member.user.username } : {}) };
      }
      catch (error) {
        if (error instanceof GrammyError && error.error_code === 400) {
          const description = error.description.toLowerCase();
          if (description.includes('user not found') || description.includes('member not found')) return null;
        }
        // Other permanent rejections would block the update cursor forever; flood limits, 5xx and network errors are retried.
        if (error instanceof GrammyError && error.error_code >= 400 && error.error_code < 500 && error.error_code !== 429) {
          console.error(JSON.stringify({ event: 'member_lookup_failed', code: error.error_code }));
          return null;
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
