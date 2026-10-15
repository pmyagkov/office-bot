import type { CallbackQuery, InlineKeyboardMarkup, Message, ReplyKeyboardMarkup, ReplyKeyboardRemove } from 'grammy/types';
import { getFlipperName, setFlipperName, validateFlipperName } from './flipper.js';
import { privateHelp } from './help.js';
import { getPlan, PLAN_KEYBOARD, planText, setPlan, type Plan } from './plans.js';
import { escapeHtml } from './messages.js';
import type { Outgoing } from './replies.js';
import { nudgeInGroup, parseSay, sayArgs, sayToGroup, sayToPerson, UNKNOWN_TARGET } from './say.js';
import type { Store } from './store.js';
import type { Choice, Participant } from './types.js';

// `at` is when the conversation was created or last advanced; it expires after an hour.
export type Conv = ({ kind: 'self_name' } | { kind: 'admin_person'; saved: number } | { kind: 'admin_name'; target: Participant; saved: number }) & { at: string };
// `pages` go back to the person who wrote; `extra` is everything addressed elsewhere.
export type Reply = { pages: string[]; markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove; extra?: Outgoing[] };
// `sayTarget` is the resolved recipient of `/admin say @username`; absent when the bot has
// never seen that username. Both it and `targetIsMember` are looked up before the transaction.
export type Facts = { admin: boolean; member?: boolean; targetIsMember?: boolean; sayTarget?: { id: number; member: boolean } };
// What the handler needs to address chats other than the one it is answering in.
export type PrivateContext = { groupChatId: number; botUsername: string };
type AdminConv = Extract<Conv, { kind: 'admin_person' | 'admin_name' }>;

const PROMPT = 'How are you listed in Flipper? Send the name exactly as it appears there.';
const INVALID = "That doesn't look right. Send the name (1–64 characters, one line).";
// Replies are sent as HTML, so the placeholders in the copy are escaped like any other text.
const MENU = 'Admin commands:\n/admin flipper — set Flipper names\n/admin say &lt;text&gt; — post to the office group\n/admin say @username &lt;text&gt; — send one person a private message';
const PICK = 'Choose a person.';
const PICKER: ReplyKeyboardMarkup = { keyboard: [[{ text: 'Choose person', request_users: { request_id: 1, user_is_bot: false, max_quantity: 1, request_name: true, request_username: true } }, { text: 'Finish' }]], resize_keyboard: true };
// Every dialog carries its own way out, so nobody has to remember a command for it. The button
// sits on the newest message of the dialog, including a rejected name.
const CANCEL_BUTTON = { text: '❌ Cancel', callback_data: 'cancel' };
const CANCEL: InlineKeyboardMarkup = { inline_keyboard: [[CANCEL_BUTTON]] };
const BACK: InlineKeyboardMarkup = { inline_keyboard: [[{ text: 'Back', callback_data: 'admin:back' }, CANCEL_BUTTON]] };
const REMOVE: ReplyKeyboardRemove = { remove_keyboard: true };
const EXPIRED = 'That admin session expired. Send /admin flipper to start again.';
const expired = (): Reply => ({ pages: [EXPIRED], markup: REMOVE });

export const isAdminConv = (conv: Conv | null | undefined): conv is AdminConv => conv?.kind === 'admin_person' || conv?.kind === 'admin_name';
// A conversation without a valid `at` (stored before expiry existed) counts as stale.
export const liveConv = (conv: Conv | null | undefined, now: Date): Conv | undefined =>
  conv && now.getTime() - Date.parse(conv.at) < 3_600_000 ? conv : undefined;
// A stale conversation is cleared before the message is handled, so it is never resumed.
// `expiredAdmin` marks the one interaction after an admin dialog timed out: the picker
// keyboard is still on the admin's screen, so that reply has to remove it.
function readConv(store: Store, key: string, now: Date): { conv: Conv | undefined; expiredAdmin: boolean } {
  const stored = store.get<Conv | null>(key);
  const conv = liveConv(stored, now);
  if (stored && !conv) store.set(key, null);
  return { conv, expiredAdmin: !!stored && !conv && isAdminConv(stored) };
}

// Admin rights are re-checked by the caller on every interaction; a non-admin in an admin state loses it.
function deny(store: Store, key: string, conv: Conv | undefined): Reply {
  if (!isAdminConv(conv)) return { pages: ['Not available.'] };
  store.set(key, null);
  return { pages: ['Not available.'], markup: REMOVE };
}

function namePrompt(target: Participant, current: string | undefined): Reply {
  return { pages: [`Flipper name for ${escapeHtml(target.name)}?${current ? `\nCurrent: ${escapeHtml(current)}` : ''}`], markup: BACK };
}

// Synchronous on purpose: callers run it inside store.atomic together with the update cursor.
// `m` is a private message from a human; commands addressed to other bots are filtered out by the caller.
export function handlePrivateMessage(store: Store, m: Message, now: Date, facts: Facts, ctx: PrivateContext): Reply | undefined {
  const from = m.from;
  const text = m.text;
  const shared = m.users_shared;
  if (!from || from.is_bot || m.chat.type !== 'private' || m.chat.id !== from.id || (text === undefined && !shared)) return undefined;
  const key = `conv:${from.id}`;
  const { conv, expiredAdmin } = readConv(store, key, now);
  const at = now.toISOString();
  if (shared) {
    if (expiredAdmin) return expired();
    if (!isAdminConv(conv)) return undefined;
    if (!facts.admin) return deny(store, key, conv);
    const picked = shared.users[0];
    if (shared.request_id !== 1 || shared.users.length !== 1) return undefined;
    const name = [picked.first_name, picked.last_name].filter(Boolean).join(' ') || `User ${picked.user_id}`;
    if (!facts.targetIsMember) {
      store.set(key, { kind: 'admin_person', saved: conv.saved, at } satisfies Conv);
      return { pages: [`${escapeHtml(name)} is not in the office group.`], markup: PICKER };
    }
    const target: Participant = { id: picked.user_id, name, ...(picked.username ? { username: picked.username } : {}) };
    store.set(key, { kind: 'admin_name', target, saved: conv.saved, at } satisfies Conv);
    return namePrompt(target, getFlipperName(store, target.id));
  }
  if (text === undefined) return undefined;
  const command = m.entities?.some(e => e.type === 'bot_command' && e.offset === 0) ? /^\/(\w+)(?:@\w+)?(?:\s+(.*))?$/s.exec(text) : null;
  if (text.startsWith('/')) {
    // A command that only reports something leaves a running dialog alone and clears nothing
    // but the keyboard an expired dialog left on screen — otherwise the admin loses the picker
    // while the dialog is still waiting, and their next message is saved as the Flipper name of
    // whoever was picked.
    const keep = expiredAdmin ? REMOVE : undefined;
    // The prompt carries an inline Cancel button, which cannot also take away the picker an
    // admin dialog left on screen, so replacing one sends the notice as its own message first.
    const ask = (): Reply => {
      const replaced = isAdminConv(conv) || expiredAdmin;
      store.set(key, { kind: 'self_name', at } satisfies Conv);
      const prompt = { chatId: from.id, pages: [PROMPT], markup: CANCEL };
      return replaced
        ? { pages: [expiredAdmin ? EXPIRED : 'The Flipper dialog for other people is closed.'], markup: REMOVE, extra: [prompt] }
        : { pages: prompt.pages, markup: CANCEL };
    };
    switch (command?.[1]) {
      case 'start':
        // Pressing Start is also what makes private reminders deliverable, so it is recorded.
        store.set(`user:${from.id}`, { id: from.id, startedAt: now.toISOString() });
        if (command[2]?.trim() === 'flipper') return ask();
        return { pages: [privateHelp(facts.admin)], markup: keep };
      case 'help': return { pages: [privateHelp(facts.admin)], markup: keep };
      case 'schedule': {
        // The plan panel carries an inline keyboard, which cannot also take away the picker an
        // expired admin dialog left on screen, so that notice is sent as its own message first.
        const panel = { chatId: from.id, pages: [planText(getPlan(store, from.id, now))], markup: PLAN_KEYBOARD };
        return expiredAdmin ? { pages: [EXPIRED], markup: REMOVE, extra: [panel] } : { pages: panel.pages, markup: PLAN_KEYBOARD };
      }
      case 'flipper': return ask();
      case 'admin': {
        if (!facts.admin) return deny(store, key, conv);
        const args = command[2]?.trim() ?? '';
        const say = sayArgs(args);
        if (say !== undefined) {
          const parsed = parseSay(say);
          if ('error' in parsed) return { pages: [parsed.error], markup: keep };
          if (!parsed.target) return { pages: [], markup: keep, extra: [sayToGroup(ctx.groupChatId, from.id, parsed.message, keep)] };
          if (!facts.sayTarget) return { pages: [], markup: keep, extra: [nudgeInGroup(ctx.groupChatId, from.id, parsed.target, ctx.botUsername, UNKNOWN_TARGET(parsed.target), keep)] };
          if (!facts.sayTarget.member) return { pages: [`${escapeHtml(parsed.target)} is not in the office group.`], markup: keep };
          return { pages: [], markup: keep, extra: [sayToPerson(facts.sayTarget.id, from.id, parsed.target, parsed.message, ctx.groupChatId, ctx.botUsername, keep)] };
        }
        if (args !== 'flipper') return { pages: [MENU], markup: keep };
        store.set(key, { kind: 'admin_person', saved: 0, at } satisfies Conv);
        return { pages: [PICK], markup: PICKER };
      }
      default: return undefined;
    }
  }
  if (expiredAdmin) return expired();
  if (isAdminConv(conv)) {
    if (!facts.admin) return deny(store, key, conv);
    if (conv.kind === 'admin_person') {
      if (text !== 'Finish') return { pages: [PICK], markup: PICKER };
      store.set(key, null);
      return { pages: [`Done, saved ${conv.saved} names.`], markup: REMOVE };
    }
    // While a name is awaited every text is the name, including the word "Finish".
    const name = validateFlipperName(text);
    if (!name) return { pages: [INVALID], markup: BACK };
    setFlipperName(store, conv.target.id, name, from.id, now);
    store.set(key, { kind: 'admin_person', saved: conv.saved + 1, at } satisfies Conv);
    return { pages: [`Saved: ${escapeHtml(name)} for ${escapeHtml(conv.target.name)}.`], markup: PICKER };
  }
  if (conv?.kind !== 'self_name') return undefined;
  const name = validateFlipperName(text);
  if (!name) return { pages: [INVALID], markup: CANCEL };
  setFlipperName(store, from.id, name, from.id, now);
  store.set(key, null);
  return { pages: [`Saved: ${escapeHtml(name)}. Go back to the group and press Check me in.`] };
}

const NEEDS_FLIPPER = 'The helper looks you up in Flipper, so a check-in needs your Flipper name. Send /flipper to set it, then plan again.';
const PLAN_PRESSED: Record<Choice, string> ={ checkin: "You're signed up for the next check-in", duty: "You're on duty at the next sign-up" };

// The Cancel button of whichever dialog is running. Rights are not checked: giving a dialog up
// only clears state. An old button tapped after the dialog ended answers the tap and no more.
function handleCancelPress(store: Store, cb: CallbackQuery, now: Date): { text: string; reply?: Reply } {
  const key = `conv:${cb.from.id}`;
  const { conv, expiredAdmin } = readConv(store, key, now);
  if (expiredAdmin) return { text: 'Not available.', reply: expired() };
  if (!conv) return { text: 'Nothing to cancel.' };
  store.set(key, null);
  return { text: 'Cancelled', reply: { pages: ['Cancelled.'], markup: REMOVE } };
}

// The `/schedule` keyboard. A plan replaces the previous one; it is never added to.
function handlePlanPress(store: Store, cb: CallbackQuery, now: Date, facts: Facts): { text: string; reply?: Reply } {
  const action = cb.data!.slice('plan:'.length);
  const show = (plan: Plan | undefined) => ({ pages: [planText(plan)], markup: PLAN_KEYBOARD });
  if (!facts.member) return { text: 'Not available.' };
  if (action === 'clear') { store.set(`plan:${cb.from.id}`, null); return { text: 'Your plan was removed', reply: show(undefined) }; }
  if (action !== 'checkin' && action !== 'duty') return { text: 'Not available.' };
  if (action === 'checkin' && !getFlipperName(store, cb.from.id)) {
    return { text: 'Set your Flipper name first', reply: { pages: [NEEDS_FLIPPER], markup: PLAN_KEYBOARD } };
  }
  const user: Participant ={ id: cb.from.id, name: [cb.from.first_name, cb.from.last_name].filter(Boolean).join(' '), ...(cb.from.username ? { username: cb.from.username } : {}) };
  return { text: PLAN_PRESSED[action], reply: show(setPlan(store, user, action, now)) };
}

// `admin:back` from the name step returns to the picker without saving. Synchronous like handlePrivateMessage.
export function handlePrivateCallback(store: Store, cb: CallbackQuery, now: Date, facts: Facts): { text: string; reply?: Reply } | undefined {
  const chat = cb.message?.chat;
  if (cb.from.is_bot || chat?.type !== 'private' || chat.id !== cb.from.id) return undefined;
  if (cb.data === 'cancel') return handleCancelPress(store, cb, now);
  if (cb.data?.startsWith('plan:')) return handlePlanPress(store, cb, now, facts);
  if (cb.data !== 'admin:back') return undefined;
  const key = `conv:${cb.from.id}`;
  const { conv, expiredAdmin } = readConv(store, key, now);
  if (expiredAdmin) return { text: 'Not available.', reply: expired() };
  if (!facts.admin) return { text: 'Not available.', reply: isAdminConv(conv) ? deny(store, key, conv) : undefined };
  if (conv?.kind !== 'admin_name') return { text: 'Not available.' };
  store.set(key, { kind: 'admin_person', saved: conv.saved, at: now.toISOString() } satisfies Conv);
  return { text: 'Back', reply: { pages: [PICK], markup: PICKER } };
}
