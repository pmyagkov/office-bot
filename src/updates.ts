import type { Update } from 'grammy/types';
import { randomInt } from 'node:crypto';
import type { Services } from './scheduler.js';
import { localTime } from './clock.js';
import { renderHistory, renderStats, renderToday } from './reports.js';
import { refreshAssignments } from './messages.js';
import { applySignupPress, confirmAssignment, type PressResult } from './input-state.js';
import { refreshSignups } from './signup.js';
import { createTestFlow } from './test-flow.js';
import { handlePrivateCallback, handlePrivateMessage, isAdminConv, liveConv, type Conv, type Facts, type PrivateContext, type Reply } from './private-chat.js';
import { flushReplies as flush, queueReply } from './replies.js';
import { findByUsername, rememberUsername } from './directory.js';
import { parseSay, sayArgs } from './say.js';
import { PRIVATE_ONLY, privateOnlyNudge } from './help.js';
export function createUpdates(services: Omit<Services, 'chooseIndex'> & { username: string }) {
  const { store, telegram, delivery, schedule, chatId, username, flipperNames } = services;
  const tests = createTestFlow({ ...services, chooseIndex: randomInt });
  const ctx: PrivateContext = { groupChatId: chatId, botUsername: username };
  const flushReplies = (now: Date) => flush(store, telegram, delivery, now);
  // `pages` answer the chat the update came from; `extra` is addressed elsewhere and keyed apart.
  function queue(key: string, chatId: number, reply: Reply) {
    if (reply.pages.length) queueReply(store, key, { chatId, pages: reply.pages, markup: reply.markup });
    reply.extra?.forEach((job, index) => queueReply(store, `${key}:to${index}`, job));
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
      // Network facts are gathered before the synchronous transaction; a temporary lookup failure throws and the cursor stays put.
      const isAdmin = async (userId: number) => ['administrator', 'creator'].includes(await telegram.getMemberStatus(chatId, userId) ?? '');
      const facts: Facts = { admin: false };
      if (privateMessage && m.from) {
        const conv = liveConv(store.get<Conv | null>(`conv:${m.from.id}`), now);
        // /start and /help list the admin commands only for admins, so they need the lookup too.
        if (['admin', 'start', 'help'].includes(command?.[1] ?? '') || isAdminConv(conv) || m.users_shared) {
          facts.admin = await isAdmin(m.from.id);
          const picked = m.users_shared?.users[0];
          if (facts.admin && isAdminConv(conv) && picked) {
            const status = await telegram.getMemberStatus(chatId, picked.user_id);
            facts.targetIsMember = status !== null && status !== 'left' && status !== 'kicked';
          }
          if (facts.admin && command?.[1] === 'admin') {
            const say = sayArgs(command[3]);
            const parsed = say === undefined ? undefined : parseSay(say);
            const target = parsed && !('error' in parsed) ? parsed.target : undefined;
            const id = target ? findByUsername(store, target) : undefined;
            if (id !== undefined) {
              const status = await telegram.getMemberStatus(chatId, id);
              facts.sayTarget = { id, member: status !== null && status !== 'left' && status !== 'kicked' };
            }
          }
        }
      } else if (cb?.data?.startsWith('admin:')) facts.admin = await isAdmin(cb.from.id);
      else if (cb?.data?.startsWith('plan:')) {
        // The group's own buttons are only reachable by members; this keyboard is in a private
        // chat, so membership has to be checked here instead.
        const status = await telegram.getMemberStatus(chatId, cb.from.id);
        facts.member = status !== null && status !== 'left' && status !== 'kicked';
      }
      let answer: PressResult | undefined;
      store.atomic(() => {
        answer = tests.apply(update, now);
        if (!answer && cb) {
          answer = applySignupPress(store, cb, now, username, flipperNames);
          if (!answer) {
            const result = handlePrivateCallback(store, cb, now, facts);
            if (result) {
              answer = { text: result.text };
              if (result.reply) queue(`callback:${update.update_id}`, cb.from.id, result.reply);
            }
          }
          if (!answer) { const text = confirmAssignment(store, cb, now); if (text) answer = { text }; }
        }
        if (cb && !answer) answer = { text: 'Not available.' };
        if (m && privateMessage) {
          rememberUsername(store, m.from!.id, m.from!.username, now);
          const reply = handlePrivateMessage(store, m, now, facts, ctx);
          if (reply) queue(`command:${update.update_id}`, m.chat.id, reply);
        } else if (m && command && addressed) {
          let pages: string[] = [];
          if (m.chat.id === chatId) {
            const day = localTime(now, schedule.zone).day;
            switch (command[1]) {
              case 'test': pages = tests.start(update, now); break;
              case 'today': pages = renderToday(store, day, schedule.zone); break;
              case 'stats': pages = [renderStats(store, day, command[3]?.trim() === 'month' ? 'month' : 'week')]; break;
              case 'history': pages = [renderHistory(store, 10, schedule.zone)]; break;
              case 'help': pages = ["Office coordination: sign-up at 09:00, helper selection at 10:00, Monday–Friday (Europe/Belgrade). The selected helper confirms with “I've checked everyone in”. At 14:00, an unconfirmed helper receives one private reminder. Open my private chat and press /start to enable reminders.\n\n/today — today's status\n/stats — this week's confirmed check-ins\n/stats month — this month's confirmed check-ins\n/history — recent confirmations\n/test — interactive test with separate statistics\n\nIn my private chat: /flipper to set your Flipper name, /schedule to sign up for the next sign-up in advance, /help for the full list.\n\nConfirmations are self-reported."]; break;
              default:
                // Everything personal belongs in the private chat; an unknown command stays
                // unanswered, because it is probably addressed to another bot.
                if ((PRIVATE_ONLY as readonly string[]).includes(command[1])) pages = [privateOnlyNudge(`/${command[1]}`, username)];
                break;
            }
          }
          if (pages.length) queueReply(store, `command:${update.update_id}`, { chatId: m.chat.id, pages });
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
