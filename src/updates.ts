import type { Update } from 'grammy/types';
import { randomInt } from 'node:crypto';
import type { Services } from './scheduler.js';
import { localTime } from './clock.js';
import { renderHistory, renderStats, renderToday } from './reports.js';
import { refreshAssignments } from './messages.js';
import { applySignupPress, confirmAssignment, type PressResult } from './input-state.js';
import { refreshSignups } from './signup.js';
import { createTestFlow } from './test-flow.js';
import { handlePrivateCallback, handlePrivateMessage, isAdminConv, type Conv, type Facts, type Reply } from './private-chat.js';
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
      const cb = update.callback_query;
      const m = update.message;
      const command = m?.entities?.some(e => e.type === 'bot_command' && e.offset === 0) ? /^\/(\w+)(?:@([\w]+))?(?:\s+(.*))?$/.exec(m.text ?? '') : null;
      const addressed = !command || !command[2] || command[2].toLowerCase() === username.toLowerCase();
      const privateMessage = !!m && addressed && !!m.from && !m.from.is_bot && m.chat.type === 'private' && m.chat.id === m.from.id;
      // Network facts are gathered before the synchronous transaction; a lookup failure throws and the cursor stays put.
      const isAdmin = async (userId: number) => ['administrator', 'creator'].includes(await telegram.getMemberStatus(chatId, userId) ?? '');
      const facts: Facts = { admin: false };
      if (privateMessage && m.from) {
        const conv = store.get<Conv | null>(`conv:${m.from.id}`) ?? undefined;
        if (command?.[1] === 'admin' || isAdminConv(conv) || m.users_shared) {
          facts.admin = await isAdmin(m.from.id);
          const picked = m.users_shared?.users[0];
          if (facts.admin && isAdminConv(conv) && picked) {
            const status = await telegram.getMemberStatus(chatId, picked.user_id);
            facts.targetIsMember = status !== null && status !== 'left' && status !== 'kicked';
          }
        }
      } else if (cb?.data?.startsWith('admin:')) facts.admin = await isAdmin(cb.from.id);
      let answer: PressResult | undefined;
      store.atomic(() => {
        answer = tests.apply(update, now);
        if (!answer && cb) {
          answer = applySignupPress(store, cb, now, username, flipperNames);
          if (!answer) {
            const result = handlePrivateCallback(store, cb, now, facts);
            if (result) {
              answer = { text: result.text };
              if (result.reply?.pages.length) { const key = `callback:${update.update_id}`; store.set(`reply:${key}`, { key, chatId: cb.from.id, pages: result.reply.pages, markup: result.reply.markup, done: false } satisfies ReplyJob); }
            }
          }
          if (!answer) { const text = confirmAssignment(store, cb, now); if (text) answer = { text }; }
        }
        if (cb && !answer) answer = { text: 'Not available.' };
        if (m && privateMessage) {
          let reply: Reply | undefined;
          if (command?.[1] === 'start' && command[3]?.trim() !== 'flipper') {
            store.set(`user:${m.from.id}`, { id: m.from.id, startedAt: now.toISOString() });
            reply = { pages: ["You're ready to receive a private reminder at 14:00 (Europe/Belgrade) if you're assigned badge duty and haven't confirmed it yet. Sign up and confirm in the group."] };
          } else reply = handlePrivateMessage(store, m, now, facts);
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
      // The test flow is flushed once per runtime step, after the whole batch is committed.
      await flushReplies(now);
    },
  };
}
