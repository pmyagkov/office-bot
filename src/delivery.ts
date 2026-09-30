import type { Store } from './store.js';
import type { Operation, SendResult } from './types.js';
export function createDelivery(store: Store) {
  for (const op of store.list<Operation>('op:')) {
    if (op.status === 'sending') store.set(`op:${op.key}`, { ...op, status: 'uncertain' });
  }
  return {
    async deliver<T>(key: string, now: Date, action: () => Promise<SendResult<T>>): Promise<SendResult<T>> {
      const previous = store.get<Operation<T>>(`op:${key}`);
      if (previous?.status === 'sent') return { kind: 'sent', value: previous.value as T };
      if (previous?.status === 'uncertain' || previous?.status === 'sending') return { kind: 'uncertain' };
      if (previous?.status === 'rejected' && (!previous.retryAt || Date.parse(previous.retryAt) > now.getTime())) {
        return { kind: 'rejected', code: previous.code! };
      }
      const op: Operation<T> = { key, status: 'sending', updatedAt: now.toISOString() };
      store.set(`op:${key}`, op);
      let result: SendResult<T>;
      try { result = await action(); } catch { result = { kind: 'uncertain' }; }
      if (result.kind === 'sent') { op.status = 'sent'; op.value = result.value; }
      else if (result.kind === 'rejected') {
        op.status = 'rejected'; op.code = result.code;
        if (result.code === 429) op.retryAt = new Date(now.getTime() + Math.max(1, result.retryAfter ?? 60) * 1000).toISOString();
      } else op.status = 'uncertain';
      store.set(`op:${key}`, op);
      return result;
    },
  };
}
export type Delivery = ReturnType<typeof createDelivery>;
