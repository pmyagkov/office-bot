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
      const commandKey = /^command:\d+:\d+$/.test(key) ? key.slice(0, key.lastIndexOf(':')) : undefined;
      if (commandKey) {
        const reply = store.get<Record<string, unknown>>(`reply:${commandKey}`);
        if (reply) store.set(`reply:${commandKey}`, { ...reply, done: false });
      }
    }
  });
}
