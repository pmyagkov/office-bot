import type { Services } from './scheduler.js';
import { isLegacy, type Choice, type DayKey, type DayState, type Operation } from './types.js';
import { assignmentMessage, confirmKeyboard } from './messages.js';
import { refreshSignups, renderSignup } from './signup.js';
import { chooseHelper } from './ranking.js';

// Both scheduled days and interactive test runs use these exact transitions.
export function createFlow({ store, telegram, delivery, schedule, chatId, chooseIndex, flipperNames }: Services) {
  const save = (day: DayState) => store.set(`day:${day.day}`, day);
  function restoreDeliveries() {
    for (const day of store.list<DayState>('day:')) {
      const signup = store.get<Operation<number>>(`op:signup:${day.day}`);
      if (day.signup && !day.signup.messageId && signup?.status === 'sent' && signup.value) {
        day.signup.messageId = signup.value; save(day);
      }
      const sent = store.get<Operation<number>>(`op:assignment:${day.day}`);
      if (day.assignment && !day.assignment.messageId && sent?.status === 'sent' && sent.value) {
        day.assignment.messageId = sent.value; save(day);
      }
    }
  }
  // Outcomes without a helper are shown in the sign-up footer, so only an assignment is sent.
  async function publish(day: DayState, now: Date) {
    const a = day.assignment;
    if (!a || a.messageId) return;
    const result = await delivery.deliver(`assignment:${day.day}`, now, () => telegram.sendMessage(chatId, assignmentMessage(a, schedule.zone), confirmKeyboard(day.day)));
    if (result.kind === 'sent') { a.messageId = result.value; save(day); }
  }
  async function openDay(key: DayKey, closesAt: Date, now: Date) {
    let day = store.get<DayState>(`day:${key}`);
    if (!day) {
      day = { day: key, chatId, phase: 'open', signup: { messageId: null, closesAt: closesAt.toISOString(), choices: {} } };
      save(day);
    }
    const signup = day.signup;
    if (isLegacy(day) || day.phase !== 'open' || !signup || signup.messageId) return;
    const { text, keyboard, signature } = renderSignup(day, schedule.zone);
    const result = await delivery.deliver(`signup:${day.day}`, now, () => telegram.sendMessage(chatId, text, keyboard));
    // Nobody can press before the message id is known, so the sent text is still current.
    if (result.kind === 'sent') { signup.messageId = result.value; signup.rendered = signature; save(day); }
  }
  async function closeDay(day: DayState, now: Date) {
    const signup = day.signup;
    if (isLegacy(day) || day.phase !== 'open' || !signup) return;
    const entries = Object.values(signup.choices);
    const pick = (choice: Choice) => entries.filter(e => e.choice === choice).map(e => e.user).sort((a, b) => a.id - b.id);
    const requests = pick('checkin'), onDuty = pick('duty');
    if (!requests.length) day.phase = 'empty';
    else if (!onDuty.length) day.phase = 'no_helpers';
    else {
      const helper = chooseHelper(onDuty, store.list<DayState>('day:'), day.day, chooseIndex);
      if (!helper) throw Error('Invalid random selection');
      const recipients = requests.map(user => {
        const flipperName = flipperNames(user.id);
        return flipperName ? { ...user, flipperName } : user;
      });
      day.phase = 'assigned';
      day.assignment = { day: day.day, chatId, helper, recipients, onDuty, messageId: null, confirmedAt: null, rendered: false };
    }
    delete day.issue;
    save(day); // Freeze the lists, Flipper names and the draw before any network request.
    console.info(JSON.stringify({ event: 'day_closed', day: day.day, phase: day.phase, requests: requests.length, onDuty: onDuty.length, helper: day.assignment?.helper.id ?? null }));
    await refreshSignups(store, telegram, schedule.zone);
    Object.assign(day, store.get<DayState>(`day:${day.day}`)); // Keep the render signature refreshSignups recorded.
    await publish(day, now);
  }
  async function remind(day: DayState, now: Date, eligible = () => true) {
    const a = day.assignment;
    if (!a?.messageId || a.confirmedAt) return;
    await delivery.deliver(`reminder:${day.day}`, now, async () => {
      if (!eligible() || store.get<DayState>(`day:${day.day}`)?.assignment?.confirmedAt) return { kind: 'rejected', code: 409 };
      const link = String(chatId).startsWith('-100') ? `\n\n<a href="https://t.me/c/${String(chatId).slice(4)}/${a.messageId}">Open assignment</a>` : `\nAssignment date: ${day.day}. Open the office group.`;
      return telegram.sendMessage(a.helper.id, `You're on badge duty today, and the check-ins haven't been confirmed yet. Once you're done, tap “I've checked everyone in” on the assignment message in the group.${link}`);
    });
  }
  return { restoreDeliveries, publish, openDay, closeDay, remind };
}
