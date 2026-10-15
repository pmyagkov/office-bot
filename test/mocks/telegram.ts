import type { Transformer } from 'grammy';
import type { Update } from 'grammy/types';
// Telegram accepts a fixed list of tags in HTML mode and answers 400 for anything else,
// including a literal `<` that was meant as text. Everything the bot sends goes out as HTML,
// so the mock holds it to the same rule instead of accepting any string.
const ALLOWED = ['b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del', 'span', 'tg-spoiler', 'tg-emoji', 'a', 'code', 'pre', 'blockquote'];
const TAG = new RegExp(`^</?(?:${ALLOWED.join('|')})(?:\\s[^<>]*)?>`, 'i');
export function unsupportedMarkup(text: string): string | undefined {
  for (let i = text.indexOf('<'); i !== -1; i = text.indexOf('<', i + 1)) {
    if (!TAG.test(text.slice(i))) return text.slice(i, i + 24);
  }
  return undefined;
}

export function mockTelegram() {
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  const messages = new Map<number, Record<string, unknown>>();
  const updates: Update[] = [];
  const members = new Map<number, string>();
  // The handle Telegram reports for a member right now, which need not be the one the bot
  // last saw in an update.
  const usernames = new Map<number, string>();
  const failures = new Map<string, { code: number; retryAfter?: number }>();
  // Chats that reject every message, the way Telegram answers someone who never pressed Start.
  const blocked = new Set<number>();
  let nextId = 1;
  const transformer: Transformer = async (_previous, method, payload) => {
    const p = payload as unknown as Record<string, unknown>;
    calls.push({ method, payload: p });
    if (p.parse_mode === 'HTML') {
      const bad = unsupportedMarkup(String(p.text ?? ''));
      if (bad) return { ok: false, error_code: 400, description: `Bad Request: unsupported start tag "${bad}"` };
    }
    const failure = failures.get(method);
    if (failure) return { ok: false, error_code: failure.code, description: 'Simulated API rejection', parameters: { retry_after: failure.retryAfter } };
    let result: unknown;
    switch (method) {
      case 'getUpdates': result = updates.splice(0, 100).filter(u => u.update_id >= Number(p.offset)); break;
      case 'sendMessage':
        if (blocked.has(Number(p.chat_id))) return { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' };
        messages.set(nextId, p); result = { message_id: nextId++ }; break;
      case 'editMessageText': messages.set(Number(p.message_id), p); result = true; break;
      case 'getChatMember': {
        const id = Number(p.user_id); const status = members.get(id);
        if (status === undefined) return { ok: false, error_code: 400, description: 'Bad Request: user not found' };
        const username = usernames.get(id);
        result = { status, user: { id, is_bot: false, first_name: `Person ${id}`, ...(username ? { username } : {}) } }; break;
      }
      case 'answerCallbackQuery': case 'setMyCommands': result = true; break;
      case 'getMe': result = { id: 123456, is_bot: true, first_name: 'Test', username: 'office_test_bot' }; break;
      default: throw Error(`Unexpected Telegram method: ${method}`);
    }
    // This dynamic API boundary follows grammY's generic transformer contract.
    return { ok: true, result: result as never };
  };
  return { calls, messages, updates, members, usernames, failures, blocked, transformer };
}
