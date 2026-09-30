import type { Store } from './store.js';
import type { Update } from 'grammy/types';
import { snapshot } from './telegram.js';
import { pollKinds, type DayState } from './types.js';
import type { Services } from './scheduler.js';
import { localTime } from './clock.js';
import { renderHistory, renderStats, renderToday } from './reports.js';
import { refreshAssignments } from './messages.js';
type Reply = { key: string; chatId: number; pages: string[]; done: boolean };
export function createUpdates({ store, telegram, delivery, schedule, chatId, username }: Omit<Services, 'chooseIndex'> & { username: string }) {
  async function flushReplies(now: Date) {
    for (const reply of store.list<Reply>('reply:')) {
      if (reply.done) continue;
      let pending = false;
      for (let i = 0; i < reply.pages.length; i++) {
        const result = await delivery.deliver(`${reply.key}:${i}`, now, () => telegram.sendMessage(reply.chatId, reply.pages[i]));
        if (result.kind === 'rejected' && result.code === 429) { pending = true; break; }
      }
      if (!pending) { reply.done = true; store.set(`reply:${reply.key}`, reply); }
    }
  }
  return {
    flushReplies,
    async handleUpdate(update: Update, now: Date): Promise<void> {
      if (update.update_id < (store.get<number>('offset') ?? 0)) return;
      let callbackText: string | undefined;
      store.atomic(() => {
        applyPollUpdate(store, update);
        const cb = update.callback_query;
        if (cb) {
          const match = /^done:(\d{4}-\d{2}-\d{2})$/.exec(cb.data ?? '');
          const state = match ? store.get<DayState>(`day:${match[1]}`) : undefined;
          const a = state?.assignment;
          if (!a || !cb.message || a.chatId !== cb.message.chat.id || a.messageId !== cb.message.message_id || cb.from.id !== a.helper.id) callbackText = 'Only the assigned helper can confirm this assignment.';
          else if (a.confirmedAt) callbackText = 'This assignment is already confirmed.';
          else { a.confirmedAt = now.toISOString(); a.rendered = false; store.set(`day:${state!.day}`, state); callbackText = 'Check-ins recorded. Thank you!'; }
        }
        const m = update.message;
        const command = m?.entities?.some(e => e.type === 'bot_command' && e.offset === 0) ? /^\/(\w+)(?:@([\w]+))?(?:\s+(.*))?$/.exec(m.text ?? '') : null;
        if (m && command && (!command[2] || command[2].toLowerCase() === username.toLowerCase())) {
          let pages: string[] = [];
          if (m.chat.type === 'private' && m.from && m.chat.id === m.from.id && command[1] === 'start') {
            store.set(`user:${m.from.id}`, { id: m.from.id, startedAt: now.toISOString() });
            pages = ["You're ready to receive a private reminder at 14:00 (Europe/Belgrade) if you're assigned badge duty and haven't confirmed it yet. Vote and confirm in the group."];
          } else if (m.chat.id === chatId) {
            const day = localTime(now, schedule.zone).day;
            switch (command[1]) {
              case 'today': pages = renderToday(store, day, schedule.zone); break;
              case 'stats': pages = [renderStats(store, day, command[3]?.trim() === 'month' ? 'month' : 'week')]; break;
              case 'history': pages = [renderHistory(store, 10, schedule.zone)]; break;
              case 'help': case 'start': pages = ["Office coordination: polls at 09:00, helper selection at 10:00, Monday–Friday (Europe/Belgrade). The selected helper confirms with “I've checked everyone in”. At 14:00, an unconfirmed helper receives one private reminder. Open my private chat and press /start to enable reminders.\n\n/today — today's status\n/stats — this week's confirmed check-ins\n/stats month — this month's confirmed check-ins\n/history — recent confirmations\n\nConfirmations are self-reported."]; break;
            }
          }
          if (pages.length) { const key = `command:${update.update_id}`; store.set(`reply:${key}`, { key, chatId: m.chat.id, pages, done: false } satisfies Reply); }
        }
        store.set('offset', update.update_id + 1);
      });
      if (update.callback_query && callbackText) await telegram.answerCallback(update.callback_query.id, callbackText);
      await refreshAssignments(store, telegram, schedule.zone);
      await flushReplies(now);
    },
  };
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
