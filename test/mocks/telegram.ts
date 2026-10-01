import type { Transformer } from 'grammy';
import type { Update } from 'grammy/types';
export function mockTelegram() {
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  const messages = new Map<number, Record<string, unknown>>();
  const updates: Update[] = [];
  const members = new Map<number, string>();
  const failures = new Map<string, { code: number; retryAfter?: number }>();
  let nextId = 1;
  const transformer: Transformer = async (_previous, method, payload) => {
    const p = payload as unknown as Record<string, unknown>;
    calls.push({ method, payload: p });
    const failure = failures.get(method);
    if (failure) return { ok: false, error_code: failure.code, description: 'Simulated API rejection', parameters: { retry_after: failure.retryAfter } };
    let result: unknown;
    switch (method) {
      case 'getUpdates': result = updates.splice(0, 100).filter(u => u.update_id >= Number(p.offset)); break;
      case 'sendMessage': messages.set(nextId, p); result = { message_id: nextId++ }; break;
      case 'editMessageText': messages.set(Number(p.message_id), p); result = true; break;
      case 'getChatMember': {
        const id = Number(p.user_id); const status = members.get(id);
        if (status === undefined) return { ok: false, error_code: 400, description: 'Bad Request: user not found' };
        result = { status, user: { id, is_bot: false, first_name: `Person ${id}` } }; break;
      }
      case 'answerCallbackQuery': case 'setMyCommands': result = true; break;
      case 'getMe': result = { id: 123456, is_bot: true, first_name: 'Test', username: 'office_test_bot' }; break;
      default: throw Error(`Unexpected Telegram method: ${method}`);
    }
    // This dynamic API boundary follows grammY's generic transformer contract.
    return { ok: true, result: result as never };
  };
  return { calls, messages, updates, members, failures, transformer };
}
