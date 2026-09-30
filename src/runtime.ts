import type { Config } from './config.js';
import type { Store } from './store.js';
import type { TelegramPort } from './telegram.js';
import { randomInt } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createDelivery } from './delivery.js';
import { createScheduler } from './scheduler.js';
import { createUpdates } from './updates.js';
export function createRuntime(config: Config, store: Store, telegram: TelegramPort, clock: () => Date, username: string) {
  const services = { store, telegram, delivery: createDelivery(store), schedule: config.schedule, chatId: config.chatId };
  const scheduler = createScheduler({ ...services, chooseIndex: randomInt, clock });
  const updates = createUpdates({ ...services, username, clock });
  async function drain(timeout: number) {
    while (true) {
      const batch = await telegram.getUpdates(store.get<number>('offset') ?? 0, timeout);
      for (const update of batch) await updates.handleUpdate(update, clock());
      if (batch.length === 0) return;
      timeout = 0;
    }
  }
  return {
    async step(timeout = 0): Promise<void> {
      scheduler.restoreDeliveries();
      updates.restoreTestDeliveries();
      await drain(timeout); // Commit queued confirmations before considering reminders.
      await scheduler.tick(clock());
      await updates.flushTestFlow(clock());
      await drain(0); // stopPoll may enqueue final poll snapshots and vote changes.
      await scheduler.finishClosing(clock());
      await updates.flushTestFlow(clock(), true);
      await updates.flushReplies(clock());
      if (config.heartbeat) {
        mkdirSync(dirname(config.heartbeat), { recursive: true, mode: 0o700 });
        writeFileSync(`${config.heartbeat}.tmp`, JSON.stringify({ at: Date.now(), pid: process.pid }), { mode: 0o600 });
        renameSync(`${config.heartbeat}.tmp`, config.heartbeat);
      }
    },
  };
}
