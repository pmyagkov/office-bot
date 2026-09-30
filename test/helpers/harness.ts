import { createDelivery } from '../../src/delivery.js';
import { createScheduler } from '../../src/scheduler.js';
import { openStore } from '../../src/store.js';
import { createTelegram } from '../../src/telegram.js';
import { applyPollUpdate } from '../../src/updates.js';
import type { DayState, PollKind } from '../../src/types.js';
import { events, groupId } from '../fixtures/telegram-updates.js';
import { mockTelegram } from '../mocks/telegram.js';
export const schedule = { zone: 'Europe/Belgrade', openMinute: 540, closeMinute: 600, reminderMinute: 840 };
export const at = (time: string, day = '2026-09-30') => new Date(`${day}T${time}:00+02:00`);
export function harness(path = ':memory:', chooseIndex = (_size: number) => 0) {
  const store = openStore(path); const mock = mockTelegram(); const event = events();
  const telegram = createTelegram('123456:dummy_dummy_dummy', { transformer: mock.transformer });
  const delivery = createDelivery(store);
  const scheduler = createScheduler({ store, telegram, delivery, schedule, chooseIndex, chatId: groupId });
  const day = () => store.get<DayState>('day:2026-09-30')!;
  const calls = (method: string) => mock.calls.filter(c => c.method === method);
  function vote(kind: PollKind, id: number, option: number | null = 0, name?: string) {
    applyPollUpdate(store, event.vote(day().polls[kind]!.id, id, option, name));
    const state = day().polls[kind]!;
    const remote = mock.polls.get(state.messageId)!;
    remote.options.forEach((o, i) => { o.voter_count = Object.values(state.votes).filter(v => v.option === i).length; });
    remote.total_voter_count = remote.options.reduce((sum, o) => sum + o.voter_count, 0);
  }
  async function close() { await scheduler.tick(at('10:00')); await scheduler.finishClosing(at('10:00')); }
  return { store, mock, event, telegram, delivery, scheduler, day, calls, vote, close };
}
