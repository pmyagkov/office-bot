import type { Store } from './store.js';
import type { TelegramPort } from './telegram.js';
import type { Delivery } from './delivery.js';
import { pollKinds, type DayState, type Operation, type PollSnapshot, type PollState, type Schedule } from './types.js';
import { localTime, scheduledInstant } from './clock.js';
import { assignmentMessage, confirmKeyboard, refreshAssignments } from './messages.js';
export type Services = { store: Store; telegram: TelegramPort; delivery: Delivery; schedule: Schedule; chatId: number; chooseIndex: (size: number) => number };
export function createScheduler({ store, telegram, delivery, schedule, chatId, chooseIndex }: Services) {
  const save = (day: DayState) => store.set(`day:${day.day}`, day);
  const due = (day: DayState, now: Date) => now >= scheduledInstant(day.day, schedule.closeMinute, schedule.zone);
  function restorePolls() {
    for (const day of store.list<DayState>('day:')) for (const kind of pollKinds) {
      const op = store.get<Operation<PollSnapshot>>(`op:poll:${day.day}:${kind}`);
      if (!day.polls[kind] && op?.status === 'sent' && op.value) {
        day.polls[kind] = { ...op.value, votes: {} }; save(day);
      }
    }
  }
  async function publish(day: DayState, now: Date) {
    const a = day.assignment;
    if (a && !a.messageId) {
      const result = await delivery.deliver(`assignment:${day.day}`, now, () => telegram.sendMessage(chatId, assignmentMessage(a, schedule.zone), confirmKeyboard(day.day)));
      if (result.kind === 'sent') { a.messageId = result.value; save(day); }
    } else if (day.phase === 'empty' || day.phase === 'no_helpers' || day.phase === 'incomplete') {
      const text = day.phase === 'empty' ? 'No check-ins are needed today.' : day.phase === 'no_helpers' ? 'There are check-in requests, but nobody volunteered to help today.' : 'The poll results are incomplete. I cannot choose a helper safely yet. See /today for status; the bot operator may need to recover missing data.';
      await delivery.deliver(`outcome:${day.day}:${day.phase}`, now, () => telegram.sendMessage(chatId, `${day.day}: ${text}`));
    }
  }
  return {
    restorePolls,
    async tick(now: Date): Promise<void> {
      restorePolls();
      const local = localTime(now, schedule.zone);
      const deadline = scheduledInstant(local.day, schedule.closeMinute, schedule.zone);
      if (local.weekday <= 5 && local.minute >= schedule.openMinute && deadline.getTime() - now.getTime() >= 5_000) {
        const day = store.get<DayState>(`day:${local.day}`) ?? { day: local.day, chatId, phase: 'open', polls: {} };
        save(day);
        if (day.phase === 'open') for (const kind of pollKinds) {
          if (day.polls[kind]) continue;
          const result = await delivery.deliver(`poll:${day.day}:${kind}`, now, () => telegram.sendPoll(chatId, kind, day.day, deadline));
          if (result.kind === 'sent') { day.polls[kind] = { ...result.value, votes: {} }; save(day); }
        }
      }
      for (const day of store.list<DayState>('day:')) {
        if (['open', 'closing', 'incomplete'].includes(day.phase) && due(day, now)) {
          day.phase = 'closing'; save(day);
          for (const kind of pollKinds) {
            const poll = day.polls[kind]; if (!poll || poll.closed) continue;
            try {
              const result = await telegram.stopPoll(chatId, poll.messageId);
              if (result) Object.assign(poll, result);
            } catch { day.issue = 'Unable to confirm poll closure. Retrying.'; }
            save(day);
          }
        } else await publish(day, now);
        const a = day.assignment;
        if (a && a.day === local.day && local.minute >= schedule.reminderMinute && a.messageId && !a.confirmedAt) {
          await delivery.deliver(`reminder:${day.day}`, now, async () => {
            if (store.get<DayState>(`day:${day.day}`)?.assignment?.confirmedAt) return { kind: 'rejected', code: 409 };
            const link = String(chatId).startsWith('-100') ? `\n\n<a href="https://t.me/c/${String(chatId).slice(4)}/${a.messageId}">Open assignment</a>` : `\nAssignment date: ${day.day}. Open the office group.`;
            return telegram.sendMessage(a.helper.id, `You're on badge duty today, and the check-ins haven't been confirmed yet. Once you're done, tap “I've checked everyone in” on the assignment message in the group.${link}`);
          });
        }
      }
      await refreshAssignments(store, telegram, schedule.zone);
    },
    async finishClosing(now: Date): Promise<void> {
      for (const day of store.list<DayState>('day:')) {
        if (!['closing', 'incomplete'].includes(day.phase) || !due(day, now)) continue;
        const complete = pollKinds.every(kind => {
          const p = day.polls[kind]; if (!p?.closed || p.optionCounts.length !== 2) return false;
          const counts = [0, 0]; for (const v of Object.values(p.votes)) if (v.option !== null) counts[v.option]++;
          return counts.every((c, i) => c === p.optionCounts[i]) && counts[0] + counts[1] === p.totalVoters;
        });
        if (!complete) { day.phase = 'incomplete'; day.issue = 'Waiting for both closed polls and all identified votes.'; }
        else {
          const affirmative = (poll: PollState) => Object.values(poll.votes).filter(v => v.option === 0).map(v => v.user).sort((a, b) => a.id - b.id);
          const requests = affirmative(day.polls.request!); const helpers = affirmative(day.polls.helper!);
          delete day.issue;
          if (!requests.length) day.phase = 'empty';
          else if (!helpers.length) day.phase = 'no_helpers';
          else {
            const index = chooseIndex(helpers.length);
            if (!Number.isInteger(index) || index < 0 || index >= helpers.length) throw Error('Invalid random selection');
            const helper = helpers[index]; const recipients = requests.filter(p => p.id !== helper.id);
            if (!recipients.length) day.phase = 'empty';
            else { day.phase = 'assigned'; day.assignment = { day: day.day, chatId, helper, recipients, messageId: null, confirmedAt: null, rendered: false }; }
          }
        }
        save(day); // Freeze the draw and recipients before any network request.
        await publish(day, now);
      }
    },
  };
}
