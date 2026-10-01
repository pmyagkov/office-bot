import type { Store } from './store.js';
import type { Operation } from './types.js';
export function recoverOperation(store: Store, key: string, mode: 'retry' | 'resolve', messageId?: number): void {
  store.atomic(() => {
    const op = store.get<Operation>(`op:${key}`);
    if (!op || !['uncertain', 'rejected', 'sending'].includes(op.status)) throw Error('Operation must exist and be unresolved');
    if (mode === 'resolve') {
      if (!Number.isSafeInteger(messageId) || messageId! <= 0) throw Error('A positive message ID is required');
      store.set(`op:${key}`, { key, status: 'sent', value: messageId!, updatedAt: new Date().toISOString() } satisfies Operation);
    } else {
      store.set(`op:${key}`, { key, status: 'prepared', updatedAt: new Date().toISOString() } satisfies Operation);
      // Reply jobs (commands and admin:back callbacks) must be reopened, or their flush would never resend.
      const replyKey = /^(command|callback):\d+:\d+$/.test(key) ? key.slice(0, key.lastIndexOf(':')) : undefined;
      if (replyKey) {
        const reply = store.get<Record<string, unknown>>(`reply:${replyKey}`);
        if (reply) store.set(`reply:${replyKey}`, { ...reply, done: false });
      }
    }
  });
}
