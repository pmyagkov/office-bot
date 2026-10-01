import type { CallbackQuery } from 'grammy/types';
import type { Store } from './store.js';
import type { Choice, DayState } from './types.js';

// Only `done:` callbacks belong to confirmation; anything else is left for other handlers.
export function confirmAssignment(store: Store, cb: CallbackQuery, now: Date): string | undefined {
  if (!cb.data?.startsWith('done:')) return undefined;
  const match = /^done:(\d{4}-\d{2}-\d{2})$/.exec(cb.data);
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
