import type { Update } from 'grammy/types';
import { randomInt } from 'node:crypto';
import type { Services } from './scheduler.js';
import { localTime } from './clock.js';
import { renderHistory, renderStats, renderToday } from './reports.js';
import { refreshAssignments } from './messages.js';
import { applyPollUpdate, confirmAssignment } from './input-state.js';
import { createTestFlow } from './test-flow.js';
export { applyPollUpdate } from './input-state.js';
type Reply = { key: string; chatId: number; pages: string[]; done: boolean };
export function createUpdates(services: Omit<Services, 'chooseIndex'> & { username: string }) {
  const { store, telegram, delivery, schedule, chatId, username } = services;
  const tests = createTestFlow({ ...services, chooseIndex: randomInt });
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
    restoreTestDeliveries: tests.restoreDeliveries,
    flushTestFlow: tests.flush,
    async handleUpdate(update: Update, now: Date): Promise<void> {
      if (update.update_id < (store.get<number>('offset') ?? 0)) return;
      tests.restoreDeliveries();
      let callbackText: string | undefined;
      store.atomic(() => {
        applyPollUpdate(store, update);
        callbackText = tests.apply(update, now);
        const cb = update.callback_query;
        if (cb && !callbackText) callbackText = confirmAssignment(store, cb, now);
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
              case 'test': pages = tests.start(update, now); break;
              case 'today': pages = renderToday(store, day, schedule.zone); break;
              case 'stats': pages = [renderStats(store, day, command[3]?.trim() === 'month' ? 'month' : 'week')]; break;
              case 'history': pages = [renderHistory(store, 10, schedule.zone)]; break;
              case 'help': case 'start': pages = ["Office coordination: polls at 09:00, helper selection at 10:00, Monday–Friday (Europe/Belgrade). The selected helper confirms with “I've checked everyone in”. At 14:00, an unconfirmed helper receives one private reminder. Open my private chat and press /start to enable reminders.\n\n/today — today's status\n/stats — this week's confirmed check-ins\n/stats month — this month's confirmed check-ins\n/history — recent confirmations\n/test — interactive test with separate statistics\n\nConfirmations are self-reported."]; break;
            }
          }
          if (pages.length) { const key = `command:${update.update_id}`; store.set(`reply:${key}`, { key, chatId: m.chat.id, pages, done: false } satisfies Reply); }
        }
        store.set('offset', update.update_id + 1);
      });
      if (update.callback_query && callbackText) await telegram.answerCallback(update.callback_query.id, callbackText);
      await refreshAssignments(store, telegram, schedule.zone);
      await tests.flush(now);
      await flushReplies(now);
    },
  };
}
