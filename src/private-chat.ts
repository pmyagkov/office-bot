import type { CallbackQuery, InlineKeyboardMarkup, Message, ReplyKeyboardMarkup, ReplyKeyboardRemove } from 'grammy/types';
import { getFlipperName, setFlipperName, validateFlipperName } from './flipper.js';
import { escapeHtml } from './messages.js';
import type { Store } from './store.js';
import type { Participant } from './types.js';

export type Conv = { kind: 'self_name' } | { kind: 'admin_person'; saved: number } | { kind: 'admin_name'; target: Participant; saved: number };
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

export const isAdminConv = (conv: Conv | null | undefined): conv is AdminConv => conv?.kind === 'admin_person' || conv?.kind === 'admin_name';

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
  const conv = store.get<Conv | null>(key) ?? undefined;
  if (shared) {
    if (!isAdminConv(conv)) return undefined;
    if (!facts.admin) return deny(store, key, conv);
    const picked = shared.users[0];
    if (shared.request_id !== 1 || shared.users.length !== 1) return undefined;
    const name = [picked.first_name, picked.last_name].filter(Boolean).join(' ') || `User ${picked.user_id}`;
    if (!facts.targetIsMember) return { pages: [`${escapeHtml(name)} is not in the office group.`], markup: PICKER };
    const target: Participant = { id: picked.user_id, name, ...(picked.username ? { username: picked.username } : {}) };
    store.set(key, { kind: 'admin_name', target, saved: conv.saved } satisfies Conv);
    return namePrompt(target, getFlipperName(store, target.id));
  }
  if (text === undefined) return undefined;
  const command = m.entities?.some(e => e.type === 'bot_command' && e.offset === 0) ? /^\/(\w+)(?:@\w+)?(?:\s+(.*))?$/.exec(text) : null;
  if (text.startsWith('/')) {
    const markup = isAdminConv(conv) ? REMOVE : undefined;
    const ask = (): Reply => { store.set(key, { kind: 'self_name' } satisfies Conv); return { pages: [PROMPT], markup }; };
    switch (command?.[1]) {
      case 'start':
        if (command[2]?.trim() !== 'flipper') return undefined;
        store.set(`user:${from.id}`, { id: from.id, startedAt: now.toISOString() });
        return ask();
      case 'flipper': return ask();
      case 'admin':
        if (!facts.admin) return deny(store, key, conv);
        if (command[2]?.trim() !== 'flipper') return { pages: [MENU] };
        store.set(key, { kind: 'admin_person', saved: 0 } satisfies Conv);
        return { pages: [PICK], markup: PICKER };
      case 'cancel':
        if (!conv) return undefined;
        store.set(key, null);
        return { pages: ['Cancelled.'], markup };
      default: return undefined;
    }
  }
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
    store.set(key, { kind: 'admin_person', saved: conv.saved + 1 } satisfies Conv);
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
export function handlePrivateCallback(store: Store, cb: CallbackQuery, _now: Date, facts: Facts): { text: string; reply?: Reply } | undefined {
  const chat = cb.message?.chat;
  if (cb.data !== 'admin:back' || cb.from.is_bot || chat?.type !== 'private' || chat.id !== cb.from.id) return undefined;
  const key = `conv:${cb.from.id}`;
  const conv = store.get<Conv | null>(key) ?? undefined;
  if (!facts.admin) return { text: 'Not available.', reply: isAdminConv(conv) ? deny(store, key, conv) : undefined };
  if (conv?.kind !== 'admin_name') return { text: 'Not available.' };
  store.set(key, { kind: 'admin_person', saved: conv.saved } satisfies Conv);
  return { text: 'Back', reply: { pages: [PICK], markup: PICKER } };
}
