import type { InlineKeyboardMarkup, ReplyKeyboardMarkup, ReplyKeyboardRemove } from 'grammy/types';
import type { Delivery } from './delivery.js';
import type { Store } from './store.js';
import type { TelegramPort } from './telegram.js';

export type Markup = InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove;
// A queued outgoing message. The follow-up is queued only once the outcome is known, so an
// acknowledgement never claims a delivery Telegram rejected or never confirmed. The three
// outcomes are kept apart on purpose: Telegram rejecting a message and Telegram not answering
// at all call for different things to be said.
export type Outgoing = { chatId: number; pages: string[]; markup?: Markup; onSent?: Outgoing; onFailed?: Outgoing; onUnknown?: Outgoing };
export type ReplyJob = Outgoing & { key: string; done: boolean };

export function queueReply(store: Store, key: string, job: Outgoing): void {
  store.set(`reply:${key}`, { ...job, key, done: false } satisfies ReplyJob);
}

// An uncertain send is never retried — the message may well have arrived — and never reported
// as delivered either. A rejection outranks it: if any page was refused outright, the whole job
// counts as failed.
export async function flushReplies(store: Store, telegram: Pick<TelegramPort, 'sendMessage'>, delivery: Delivery, now: Date): Promise<void> {
  // A follow-up queued by one pass is delivered by the next, so a whole chain leaves in one step.
  for (let pass = 0; pass < 10; pass++) {
    let progressed = false;
    for (const reply of store.list<ReplyJob>('reply:')) {
      if (reply.done) continue;
      let pending = false, failed = false, unknown = false;
      for (let i = 0; i < reply.pages.length; i++) {
        const markup = i === reply.pages.length - 1 ? reply.markup : undefined;
        const result = await delivery.deliver(`${reply.key}:${i}`, now, () => telegram.sendMessage(reply.chatId, reply.pages[i], markup));
        if (result.kind === 'rejected' && result.code === 429) { pending = true; break; }
        if (result.kind === 'rejected') failed = true;
        if (result.kind === 'uncertain') unknown = true;
      }
      if (pending) continue;
      reply.done = true; store.set(`reply:${reply.key}`, reply); progressed = true;
      const outcome = failed ? 'failed' : unknown ? 'unknown' : 'sent';
      const next = { failed: reply.onFailed, unknown: reply.onUnknown, sent: reply.onSent }[outcome];
      if (next) queueReply(store, `${reply.key}:${outcome}`, next);
    }
    if (!progressed) return;
  }
}
