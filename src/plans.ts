import type { InlineKeyboardMarkup } from 'grammy/types';
import { queueReply } from './replies.js';
import type { Store } from './store.js';
import type { Choice, DayState, Participant } from './types.js';

// A one-shot intention, applied to whichever sign-up opens next. Keyed by person rather than by
// date: the bot opens no sign-up on a weekend or a holiday, and a plan made on Friday night is
// still meant for the next working day.
export type Plan = { user: Participant; choice: Choice; at: string };
const LIFETIME = 7 * 24 * 3_600_000;

export const INTRO = "Plan your next sign-up. I apply it the moment the sign-up opens, so a plan made tonight lands on tomorrow morning's sign-up.";
export const PLAN_KEYBOARD: InlineKeyboardMarkup = { inline_keyboard: [
  [{ text: '🙋 Check me in', callback_data: 'plan:checkin' }, { text: '🛡 On duty', callback_data: 'plan:duty' }],
  [{ text: '❌ Clear plan', callback_data: 'plan:clear' }],
] };
export const PLAN_LABEL: Record<Choice, string> = { checkin: '🙋 Check me in', duty: '🛡 On duty' };

export const livePlan = (plan: Plan | null | undefined, now: Date): Plan | undefined =>
  plan && now.getTime() - Date.parse(plan.at) < LIFETIME ? plan : undefined;

export function getPlan(store: Store, userId: number, now: Date): Plan | undefined {
  return livePlan(store.get<Plan | null>(`plan:${userId}`), now);
}

export function planText(plan: Plan | undefined): string {
  return `${INTRO}\n\n${plan ? `Planned: ${PLAN_LABEL[plan.choice]}.` : 'Nothing is planned.'}`;
}

export function setPlan(store: Store, user: Participant, choice: Choice, now: Date): Plan {
  const plan: Plan = { user, choice, at: now.toISOString() };
  store.set(`plan:${user.id}`, plan);
  return plan;
}

// Called once, on the day a sign-up is created, before its message is composed: a plan is part
// of the very first version of the sign-up and never causes an edit. Every plan is consumed,
// including a stale one, so nothing lingers into a later day.
export function applyPlans(store: Store, day: DayState, now: Date, flipper: (id: number) => string | undefined): void {
  const signup = day.signup;
  if (!signup) return;
  for (const stored of store.list<Plan | null>('plan:')) {
    const plan = livePlan(stored, now);
    if (!stored) continue;
    const id = (plan ?? stored).user.id;
    store.set(`plan:${id}`, null);
    if (!plan) continue;
    if (plan.choice === 'checkin' && !flipper(id)) {
      queueReply(store, `plan-dropped:${day.day}:${id}`, { chatId: id,
        pages: [`I could not sign you up for a check-in today: your Flipper name is gone. Send /flipper to set it again.`] });
      continue;
    }
    signup.choices[String(id)] = { user: plan.user, choice: plan.choice };
  }
}
