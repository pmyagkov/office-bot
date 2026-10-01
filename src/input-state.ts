import type { CallbackQuery, Update } from 'grammy/types';
import type { Store } from './store.js';
import { pollKinds, type Choice, type DayState } from './types.js';
import { snapshot } from './telegram.js';

export function confirmAssignment(store: Store, cb: CallbackQuery, now: Date): string {
  const match = /^done:(\d{4}-\d{2}-\d{2})$/.exec(cb.data ?? '');
  const state = match ? store.get<DayState>(`day:${match[1]}`) : undefined;
  const a = state?.assignment;
  if (!a || !cb.message || a.chatId !== cb.message.chat.id || a.messageId !== cb.message.message_id || cb.from.id !== a.helper.id) return 'Only the assigned helper can confirm this assignment.';
  if (a.confirmedAt) return 'This assignment is already confirmed.';
  a.confirmedAt = now.toISOString(); a.rendered = false; store.set(`day:${state!.day}`, state);
  return 'Check-ins recorded. Thank you!';
}

export type PressResult = { text: string; url?: string };
const CLOSED: PressResult = { text: 'Sign-up is closed' };
const PRESS_TEXT: Record<Choice | 'discard', string> = { checkin: "You're signed up for a check-in", duty: "You're on duty", discard: 'Your sign-up was removed' };

// Synchronous on purpose: callers run it inside store.atomic together with the update cursor.
export function applySignupPress(store: Store, cb: CallbackQuery, now: Date, botUsername: string, flipper: (id: number) => string | undefined): PressResult | undefined {
  if (!cb.data?.startsWith('signup:')) return undefined;
  const match = /^signup:(\d{4}-\d{2}-\d{2}):(checkin|duty|discard)$/.exec(cb.data);
  const state = match ? store.get<DayState>(`day:${match[1]}`) : undefined;
  const signup = state?.signup;
  if (!state || !signup || state.phase !== 'open' || !cb.message || cb.message.chat.id !== state.chatId
    || cb.message.message_id !== signup.messageId || now.getTime() >= Date.parse(signup.closesAt)) return CLOSED;
  if (cb.from.is_bot) return { text: '' };
  const action = match![2] as Choice | 'discard', id = String(cb.from.id);
  if (action === 'checkin' && !flipper(cb.from.id)) {
    return { text: 'Register your Flipper name first. Opening the bot…', url: `https://t.me/${botUsername}?start=flipper` };
  }
  if (action === 'discard') delete signup.choices[id];
  else signup.choices[id] = { user: { id: cb.from.id, name: [cb.from.first_name, cb.from.last_name].filter(Boolean).join(' '), username: cb.from.username }, choice: action };
  store.set(`day:${state.day}`, state);
  return { text: PRESS_TEXT[action] };
}

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
