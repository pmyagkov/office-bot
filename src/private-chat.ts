import type { CallbackQuery, InlineKeyboardMarkup, Message, ReplyKeyboardMarkup, ReplyKeyboardRemove } from 'grammy/types';
import { getFlipperName, setFlipperName, validateFlipperName } from './flipper.js';
import { escapeHtml } from './messages.js';
import type { Store } from './store.js';
import type { Participant } from './types.js';

// `at` is when the conversation was created or last advanced; it expires after an hour.
export type Conv = ({ kind: 'self_name' } | { kind: 'admin_person'; saved: number } | { kind: 'admin_name'; target: Participant; saved: number }) & { at: string };
export type Reply = { pages: string[]; markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove };
export type Facts = { admin: boolean; targetIsMember?: boolean };
type AdminConv = Extract<Conv, { kind: 'admin_person' | 'admin_name' }>;

const PROMPT = 'How are you listed in Flipper? Send the name exactly as it appears there.';
const INVALID = "That doesn't look right. Send the name (1–64 characters, one line).";
const MENU = 'Admin commands:\n/admin flipper — set Flipper names';
const PICK = 'Choose a person.';
const PICKER: ReplyKeyboardMarkup = { keyboard: [[{ text: 'Choose person', request_users: { request_id: 1, user_is_bot: false, max_quantity: 1, request_name: true, request_username: true } }, { text: 'Finish' }]], resize_keyboard: true };
const BACK: InlineKeyboardMarkup = { inline_keyboard: [[{ text: 'Back', callback_data: 'admin:back' }]] };
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
export function handlePrivateMessage(store: Store, m: Message, now: Date, facts: Facts): Reply | undefined {
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
  const command = m.entities?.some(e => e.type === 'bot_command' && e.offset === 0) ? /^\/(\w+)(?:@\w+)?(?:\s+(.*))?$/.exec(text) : null;
  if (text.startsWith('/')) {
    const markup = isAdminConv(conv) || expiredAdmin ? REMOVE : undefined;
    const ask = (): Reply => { store.set(key, { kind: 'self_name', at } satisfies Conv); return { pages: [PROMPT], markup }; };
    switch (command?.[1]) {
      case 'start':
        if (command[2]?.trim() !== 'flipper') return undefined;
        store.set(`user:${from.id}`, { id: from.id, startedAt: now.toISOString() });
        return ask();
      case 'flipper': return ask();
      case 'admin':
        if (!facts.admin) return deny(store, key, conv);
        if (command[2]?.trim() !== 'flipper') return { pages: [MENU], markup };
        store.set(key, { kind: 'admin_person', saved: 0, at } satisfies Conv);
        return { pages: [PICK], markup: PICKER };
      case 'cancel':
        if (!conv && !expiredAdmin) return undefined;
        store.set(key, null);
        return { pages: ['Cancelled.'], markup };
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
    if (!name) return { pages: [INVALID] };
    setFlipperName(store, conv.target.id, name, from.id, now);
    store.set(key, { kind: 'admin_person', saved: conv.saved + 1, at } satisfies Conv);
    return { pages: [`Saved: ${escapeHtml(name)} for ${escapeHtml(conv.target.name)}.`], markup: PICKER };
  }
  if (conv?.kind !== 'self_name') return undefined;
  const name = validateFlipperName(text);
  if (!name) return { pages: [INVALID] };
  setFlipperName(store, from.id, name, from.id, now);
  store.set(key, null);
  return { pages: [`Saved: ${escapeHtml(name)}. Go back to the group and press Check me in.`] };
}

// `admin:back` from the name step returns to the picker without saving. Synchronous like handlePrivateMessage.
export function handlePrivateCallback(store: Store, cb: CallbackQuery, now: Date, facts: Facts): { text: string; reply?: Reply } | undefined {
  const chat = cb.message?.chat;
  if (cb.data !== 'admin:back' || cb.from.is_bot || chat?.type !== 'private' || chat.id !== cb.from.id) return undefined;
  const key = `conv:${cb.from.id}`;
  const { conv, expiredAdmin } = readConv(store, key, now);
  if (expiredAdmin) return { text: 'Not available.', reply: expired() };
  if (!facts.admin) return { text: 'Not available.', reply: isAdminConv(conv) ? deny(store, key, conv) : undefined };
  if (conv?.kind !== 'admin_name') return { text: 'Not available.' };
  store.set(key, { kind: 'admin_person', saved: conv.saved, at: now.toISOString() } satisfies Conv);
  return { text: 'Back', reply: { pages: [PICK], markup: PICKER } };
}
