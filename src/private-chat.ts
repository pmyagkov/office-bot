import type { InlineKeyboardMarkup, Message, ReplyKeyboardMarkup, ReplyKeyboardRemove } from 'grammy/types';
import { setFlipperName, validateFlipperName } from './flipper.js';
import { escapeHtml } from './messages.js';
import type { Store } from './store.js';
import type { Participant } from './types.js';

export type Conv = { kind: 'self_name' } | { kind: 'admin_person'; saved: number } | { kind: 'admin_name'; target: Participant; saved: number };
export type Reply = { pages: string[]; markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove };
export type Facts = { admin: boolean; targetIsMember?: boolean };

const PROMPT = 'How are you listed in Flipper? Send the name exactly as it appears there.';
const INVALID = "That doesn't look right. Send the name (1–64 characters, one line).";

// Synchronous on purpose: callers run it inside store.atomic together with the update cursor.
// `m` is a private message from a human; commands addressed to other bots are filtered out by the caller.
export function handlePrivateMessage(store: Store, m: Message, now: Date, _facts: Facts): Reply | undefined {
  const from = m.from;
  if (!from || from.is_bot || m.chat.type !== 'private' || m.chat.id !== from.id || !m.text) return undefined;
  const key = `conv:${from.id}`;
  const conv = store.get<Conv | null>(key) ?? undefined;
  const command = m.entities?.some(e => e.type === 'bot_command' && e.offset === 0) ? /^\/(\w+)(?:@\w+)?(?:\s+(.*))?$/.exec(m.text) : null;
  if (m.text.startsWith('/')) {
    const ask = (): Reply => { store.set(key, { kind: 'self_name' } satisfies Conv); return { pages: [PROMPT] }; };
    switch (command?.[1]) {
      case 'start':
        if (command[2]?.trim() !== 'flipper') return undefined;
        store.set(`user:${from.id}`, { id: from.id, startedAt: now.toISOString() });
        return ask();
      case 'flipper': return ask();
      case 'cancel':
        if (!conv) return undefined;
        store.set(key, null);
        return { pages: ['Cancelled.'] };
      default: return undefined;
    }
  }
  if (conv?.kind !== 'self_name') return undefined;
  const name = validateFlipperName(m.text);
  if (!name) return { pages: [INVALID] };
  setFlipperName(store, from.id, name, from.id, now);
  store.set(key, null);
  return { pages: [`Saved: ${escapeHtml(name)}. Go back to the group and press Check me in.`] };
}
