import type { InlineKeyboardMarkup, ReplyKeyboardMarkup, ReplyKeyboardRemove } from 'grammy/types';
import type { Delivery } from './delivery.js';
import type { Store } from './store.js';
import type { TelegramPort } from './telegram.js';

export type Markup = InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove;
// A queued outgoing message. `onSent` and `onFailed` are queued only once the outcome is known,
// so an acknowledgement never claims a delivery Telegram rejected.
export type Outgoing = { chatId: number; pages: string[]; markup?: Markup; onSent?: Outgoing; onFailed?: Outgoing };
export type ReplyJob = Outgoing & { key: string; done: boolean };

export function queueReply(store: Store, key: string, job: Outgoing): void {
  store.set(`reply:${key}`, { ...job, key, done: false } satisfies ReplyJob);
}

// An uncertain send is never treated as a failure: the message may well have arrived, and
// office-bot does not resend blindly. Only an explicit rejection takes the `onFailed` branch.
export async function flushReplies(store: Store, telegram: Pick<TelegramPort, 'sendMessage'>, delivery: Delivery, now: Date): Promise<void> {
  // A follow-up queued by one pass is delivered by the next, so a whole chain leaves in one step.
  for (let pass = 0; pass < 10; pass++) {
    let progressed = false;
    for (const reply of store.list<ReplyJob>('reply:')) {
      if (reply.done) continue;
      let pending = false, failed = false;
      for (let i = 0; i < reply.pages.length; i++) {
        const markup = i === reply.pages.length - 1 ? reply.markup : undefined;
        const result = await delivery.deliver(`${reply.key}:${i}`, now, () => telegram.sendMessage(reply.chatId, reply.pages[i], markup));
        if (result.kind === 'rejected' && result.code === 429) { pending = true; break; }
        if (result.kind === 'rejected') failed = true;
      }
      if (pending) continue;
      reply.done = true; store.set(`reply:${reply.key}`, reply); progressed = true;
      const next = failed ? reply.onFailed : reply.onSent;
      if (next) queueReply(store, `${reply.key}:${failed ? 'failed' : 'sent'}`, next);
    }
    if (!progressed) return;
  }
}
