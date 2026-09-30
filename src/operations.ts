import type { Store } from './store.js';
import type { Operation, PollSnapshot } from './types.js';
export function recoverOperation(store: Store, key: string, mode: 'retry' | 'resolve', messageId?: number, pollId?: string): void {
  store.atomic(() => {
    const op = store.get<Operation>(`op:${key}`);
    if (!op || !['uncertain', 'rejected', 'sending'].includes(op.status)) throw Error('Operation must exist and be unresolved');
    if (mode === 'resolve') {
      if (!Number.isSafeInteger(messageId) || messageId! <= 0) throw Error('A positive message ID is required');
      let value: number | PollSnapshot = messageId!;
      if (key.startsWith('poll:')) {
        if (!pollId?.trim()) throw Error('A poll ID is required to resolve a poll');
        value = { id: pollId, messageId: messageId!, closed: false, optionCounts: [0, 0], totalVoters: 0 };
      }
      store.set(`op:${key}`, { key, status: 'sent', value, updatedAt: new Date().toISOString() } satisfies Operation);
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
