import type { InlineKeyboardMarkup } from 'grammy/types';
import type { Store } from './store.js';
import type { TelegramPort } from './telegram.js';
import { isLegacy, type Choice, type DayState, type Participant } from './types.js';
import { clockLabel, displayName, escapeHtml } from './messages.js';

function dayHeader(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  const at = new Date(Date.UTC(year, month - 1, date));
  const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short' }).format(at);
  const rest = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(at);
  return `${weekday}, ${rest}`;
}
function section(title: string, people: Participant[]): string {
  return `${title} · ${people.length}\n${people.length ? people.map(p => escapeHtml(displayName(p))).join(', ') : '—'}`;
}
function footer(day: DayState, zone: string): string {
  if (day.phase === 'open') return `Sign-up closes at ${clockLabel(day.signup!.closesAt, zone)}`;
  if (day.phase === 'empty') return '🔒 Sign-up closed · No check-ins needed today';
  if (day.phase === 'no_helpers') return '🔒 Sign-up closed · Nobody is on duty today';
  if (day.phase === 'assigned' && day.assignment) return `🔒 Sign-up closed · 🛡 Duty: ${escapeHtml(displayName(day.assignment.helper))}`;
  return '🔒 Sign-up closed';
}
export function signupText(day: DayState, zone: string, last = footer(day, zone)): string {
  const entries = Object.values(day.signup?.choices ?? {});
  const by = (choice: Choice) => entries.filter(e => e.choice === choice).map(e => e.user);
  return [`🏢 Office · ${dayHeader(day.day)}`, section('🙋 Need check-in', by('checkin')), section('🛡 On duty', by('duty')), last].join('\n\n');
}
export function signupKeyboard(day: DayState): InlineKeyboardMarkup {
  if (day.phase !== 'open') return { inline_keyboard: [] };
  const data = (action: Choice | 'discard') => `signup:${day.day}:${action}`;
  return { inline_keyboard: [
    [{ text: '🙋 Check me in', callback_data: data('checkin') }, { text: '🛡 On duty', callback_data: data('duty') }],
    [{ text: '❌ Discard', callback_data: data('discard') }],
  ] };
}
// `signature` is what refreshSignups compares against `signup.rendered` to skip redundant edits.
export function renderSignup(day: DayState, zone: string) {
  const text = signupText(day, zone), keyboard = signupKeyboard(day);
  return { text, keyboard, signature: JSON.stringify({ text, keyboard }) };
}
export async function refreshSignups(store: Store, telegram: Pick<TelegramPort, 'editMessage'>, zone: string): Promise<void> {
  for (const day of store.list<DayState>('day:')) {
    const signup = day.signup;
    if (!signup?.messageId || isLegacy(day)) continue;
    const { text, keyboard, signature } = renderSignup(day, zone);
    if (signature === signup.rendered) continue;
    try {
      await telegram.editMessage(day.chatId, signup.messageId, text, keyboard);
      // Re-read: a press may have landed during the edit; only the signature of what was sent is recorded.
      store.atomic(() => {
        const fresh = store.get<DayState>(`day:${day.day}`);
        if (fresh?.signup) { fresh.signup.rendered = signature; store.set(`day:${day.day}`, fresh); }
      });
    } catch { console.error(JSON.stringify({ event: 'signup_edit_failed', day: day.day })); }
  }
}
