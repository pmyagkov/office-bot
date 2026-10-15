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
import { COMMANDS, MEMBERS_ONLY, privateOnlyNudge } from './help.js';
export function createUpdates(services: Omit<Services, 'chooseIndex'> & { username: string }) {
  const { store, telegram, delivery, schedule, chatId, username, flipperNames } = services;
  const tests = createTestFlow({ ...services, chooseIndex: randomInt });
  const ctx: PrivateContext = { groupChatId: chatId, botUsername: username };
  const flushReplies = (now: Date) => flush(store, telegram, delivery, now);
  // The commands that only read state and answer with text. `/test` is here too: it is driven
  // from the private chat, and its panel and messages still go to the group.
  // In the group Telegram guaranteed that whoever typed one of these was a member. A private
  // chat guarantees nothing, so membership is checked before any of the group's data leaves,
  // and before a stranger can put a test panel in front of everybody.
  function reports(command: RegExpExecArray, update: Update, now: Date, facts: Facts): string[] {
    const day = localTime(now, schedule.zone).day;
    if (!MEMBERS_ONLY.includes(command[1])) return [];
    if (!facts.member) return ['Only members of the office group can use this.'];
    switch (command[1]) {
      case 'test': return tests.start(update, now);
      case 'today': return renderToday(store, day, schedule.zone);
      case 'stats': return [renderStats(store, day, command[3]?.trim() === 'month' ? 'month' : 'week')];
      case 'history': return [renderHistory(store, 10, schedule.zone)];
      default: return [];
    }
  }
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
      // `s`: the arguments of `/admin say` may be a message of several lines.
      const command = m?.entities?.some(e => e.type === 'bot_command' && e.offset === 0) ? /^\/(\w+)(?:@([\w]+))?(?:\s+(.*))?$/s.exec(m.text ?? '') : null;
      const addressed = !command || !command[2] || command[2].toLowerCase() === username.toLowerCase();
      const privateMessage = !!m && addressed && !!m.from && !m.from.is_bot && m.chat.type === 'private' && m.chat.id === m.from.id;
      // Network facts are gathered before the synchronous transaction; a temporary lookup failure throws and the cursor stays put.
      const isAdmin = async (userId: number) => ['administrator', 'creator'].includes(await telegram.getMemberStatus(chatId, userId) ?? '');
      const isMember = async (userId: number) => {
        const status = await telegram.getMemberStatus(chatId, userId);
        return status !== null && status !== 'left' && status !== 'kicked';
      };
      const facts: Facts = { admin: false };
      if (privateMessage && m.from && MEMBERS_ONLY.includes(command?.[1] ?? '')) facts.member = await isMember(m.from.id);
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
            const wanted = target?.replace(/^@/, '').toLowerCase();
            const id = wanted ? findByUsername(store, wanted) : undefined;
            if (id !== undefined) {
              const member = await telegram.getMember(chatId, id);
              // A handle Telegram no longer reports for this person belongs to somebody else
              // now, or to nobody; either way the index is stale and nothing is sent privately.
              if (member && member.username?.toLowerCase() === wanted) {
                facts.sayTarget = { id, member: member.status !== 'left' && member.status !== 'kicked' };
              }
            }
          }
        }
      } else if (cb?.data?.startsWith('admin:')) facts.admin = await isAdmin(cb.from.id);
      // The group's own buttons are only reachable by members; this keyboard is in a private
      // chat, so membership has to be checked here instead.
      else if (cb?.data?.startsWith('plan:')) facts.member = await isMember(cb.from.id);
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
          // Dialogs and personal settings first; the reports are commands without a dialog.
          const reply = handlePrivateMessage(store, m, now, facts, ctx) ?? (command ? { pages: reports(command, update, now, facts) } : undefined);
          if (reply) queue(`command:${update.update_id}`, m.chat.id, reply);
        } else if (m && command && addressed && m.chat.id === chatId && (COMMANDS as readonly string[]).includes(command[1])) {
          // Nothing the bot owns is answered in the group: a command there is replaced by one
          // pointer to the private chat. An unknown command stays unanswered, because it is
          // probably addressed to another bot.
          queueReply(store, `command:${update.update_id}`, { chatId: m.chat.id, pages: [privateOnlyNudge(`/${command[1]}${command[3] ? ` ${command[3]}` : ''}`, username)] });
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
