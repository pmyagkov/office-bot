import type { Store } from './store.js';
import type { Update } from 'grammy/types';
import { snapshot } from './telegram.js';
import { pollKinds, type DayState } from './types.js';
export function applyPollUpdate(store: Store, update: Update): void {
  const pollId = update.poll_answer?.poll_id ?? update.poll?.id;
  if (!pollId) return;
  for (const day of store.list<DayState>('day:')) {
    if (!['open', 'closing', 'incomplete'].includes(day.phase)) continue;
    for (const kind of pollKinds) {
      const poll = day.polls[kind]; if (poll?.id !== pollId) continue;
      const answer = update.poll_answer;
      if (answer?.user && !answer.user.is_bot && Number.isSafeInteger(answer.user.id)) {
        const option = answer.option_ids[0] ?? null;
        if (answer.option_ids.length <= 1 && (option === null || option === 0 || option === 1)) {
          poll.votes[String(answer.user.id)] = { user: { id: answer.user.id,
            name: [answer.user.first_name, answer.user.last_name].filter(Boolean).join(' '), username: answer.user.username }, option };
        }
      }
      if (update.poll && (!poll.closed || update.poll.is_closed)) Object.assign(poll, snapshot(update.poll, poll.messageId));
      store.set(`day:${day.day}`, day); return;
    }
  }
}
