import type { Update } from 'grammy/types';
import { randomInt } from 'node:crypto';
import type { Services } from './scheduler.js';
import { localTime } from './clock.js';
import { renderHistory, renderStats, renderToday } from './reports.js';
import { refreshAssignments } from './messages.js';
import { applySignupPress, confirmAssignment, type PressResult } from './input-state.js';
import { refreshSignups } from './signup.js';
import { createTestFlow } from './test-flow.js';
import { handlePrivateMessage, type Reply } from './private-chat.js';
type ReplyJob = { key: string; chatId: number; pages: string[]; markup?: Reply['markup']; done: boolean };
export function createUpdates(services: Omit<Services, 'chooseIndex'> & { username: string }) {
  const { store, telegram, delivery, schedule, chatId, username, flipperNames } = services;
  const tests = createTestFlow({ ...services, chooseIndex: randomInt });
  async function flushReplies(now: Date) {
    for (const reply of store.list<ReplyJob>('reply:')) {
      if (reply.done) continue;
      let pending = false;
      for (let i = 0; i < reply.pages.length; i++) {
        const markup = i === reply.pages.length - 1 ? reply.markup : undefined;
        const result = await delivery.deliver(`${reply.key}:${i}`, now, () => telegram.sendMessage(reply.chatId, reply.pages[i], markup));
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
      let answer: PressResult | undefined;
      store.atomic(() => {
        const testText = tests.apply(update, now);
        const cb = update.callback_query;
        if (testText !== undefined) answer = { text: testText };
        else if (cb) {
          answer = applySignupPress(store, cb, now, username, flipperNames);
          if (!answer) { const text = confirmAssignment(store, cb, now); if (text) answer = { text }; }
        }
        if (cb && !answer) answer = { text: 'Not available.' };
        const m = update.message;
        const command = m?.entities?.some(e => e.type === 'bot_command' && e.offset === 0) ? /^\/(\w+)(?:@([\w]+))?(?:\s+(.*))?$/.exec(m.text ?? '') : null;
        const addressed = !command || !command[2] || command[2].toLowerCase() === username.toLowerCase();
        if (m && addressed && m.from && !m.from.is_bot && m.chat.type === 'private' && m.chat.id === m.from.id) {
          let reply: Reply | undefined;
          if (command?.[1] === 'start' && command[3]?.trim() !== 'flipper') {
            store.set(`user:${m.from.id}`, { id: m.from.id, startedAt: now.toISOString() });
            reply = { pages: ["You're ready to receive a private reminder at 14:00 (Europe/Belgrade) if you're assigned badge duty and haven't confirmed it yet. Sign up and confirm in the group."] };
          } else reply = handlePrivateMessage(store, m, now, { admin: false });
          if (reply?.pages.length) { const key = `command:${update.update_id}`; store.set(`reply:${key}`, { key, chatId: m.chat.id, pages: reply.pages, markup: reply.markup, done: false } satisfies ReplyJob); }
        } else if (m && command && addressed) {
          let pages: string[] = [];
          if (m.chat.id === chatId) {
            const day = localTime(now, schedule.zone).day;
            switch (command[1]) {
              case 'test': pages = tests.start(update, now); break;
              case 'today': pages = renderToday(store, day, schedule.zone); break;
              case 'stats': pages = [renderStats(store, day, command[3]?.trim() === 'month' ? 'month' : 'week')]; break;
              case 'history': pages = [renderHistory(store, 10, schedule.zone)]; break;
              case 'help': case 'start': pages = ["Office coordination: sign-up at 09:00, helper selection at 10:00, Monday–Friday (Europe/Belgrade). The selected helper confirms with “I've checked everyone in”. At 14:00, an unconfirmed helper receives one private reminder. Open my private chat and press /start to enable reminders.\n\n/today — today's status\n/stats — this week's confirmed check-ins\n/stats month — this month's confirmed check-ins\n/history — recent confirmations\n/test — interactive test with separate statistics\n/flipper — set your Flipper name (in a private chat)\n\nConfirmations are self-reported."]; break;
            }
          }
          if (pages.length) { const key = `command:${update.update_id}`; store.set(`reply:${key}`, { key, chatId: m.chat.id, pages, done: false } satisfies ReplyJob); }
        }
        store.set('offset', update.update_id + 1);
      });
      if (update.callback_query && answer) await telegram.answerCallback(update.callback_query.id, answer.text, answer.url);
      await refreshSignups(store, telegram, schedule.zone);
      await refreshAssignments(store, telegram, schedule.zone);
      await tests.flush(now);
      await flushReplies(now);
    },
  };
}
