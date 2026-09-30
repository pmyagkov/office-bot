import type { Transformer } from 'grammy';
import type { Poll, Update } from 'grammy/types';
export function mockTelegram() {
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  const polls = new Map<number, Poll>();
  const messages = new Map<number, Record<string, unknown>>();
  const updates: Update[] = [];
  const failures = new Map<string, { code: number; retryAfter?: number }>();
  let nextId = 1;
  const transformer: Transformer = async (_previous, method, payload) => {
    const p = payload as unknown as Record<string, unknown>;
    calls.push({ method, payload: p });
    const failure = failures.get(method);
    if (failure) return { ok: false, error_code: failure.code, description: 'Simulated API rejection', parameters: { retry_after: failure.retryAfter } };
    let result: unknown;
    switch (method) {
      case 'sendPoll': {
        const poll: Poll = { id: `poll-${nextId}`, question: String(p.question), options: (p.options as {text: string}[]).map((o, i) => ({ ...o, persistent_id: String(i), voter_count: 0 })), total_voter_count: 0, is_closed: false, is_anonymous: false, type: 'regular', allows_multiple_answers: false, allows_revoting: true, members_only: false };
        polls.set(nextId, poll); result = { message_id: nextId++, poll }; break;
      }
      case 'stopPoll': { const poll = polls.get(Number(p.message_id)); if (!poll) throw Error('Unknown poll'); poll.is_closed = true; result = poll; break; }
      case 'getUpdates': result = updates.splice(0, 100).filter(u => u.update_id >= Number(p.offset)); break;
      case 'sendMessage': messages.set(nextId, p); result = { message_id: nextId++ }; break;
      case 'editMessageText': messages.set(Number(p.message_id), p); result = true; break;
      case 'answerCallbackQuery': case 'setMyCommands': result = true; break;
      case 'getMe': result = { id: 123456, is_bot: true, first_name: 'Test', username: 'office_test_bot' }; break;
      default: throw Error(`Unexpected Telegram method: ${method}`);
    }
    // This dynamic API boundary follows grammY's generic transformer contract.
    return { ok: true, result: result as never };
  };
  return { calls, polls, messages, updates, failures, transformer };
}
