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
      // A reply job must be reopened too, or its flush would never resend. Every page of one is
      // delivered under `<reply key>:<page>`, whatever shape the reply key itself has; the
      // lookup below is what decides, so an operation that is not a reply page stays untouched.
      const page = /^(.*):\d+$/.exec(key);
      const reply = page && store.get<Record<string, unknown>>(`reply:${page[1]}`);
      if (page && reply) store.set(`reply:${page[1]}`, { ...reply, done: false });
    }
  });
}
