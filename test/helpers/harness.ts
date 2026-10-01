import { createDelivery } from '../../src/delivery.js';
import { getFlipperName, setFlipperName } from '../../src/flipper.js';
import { applySignupPress } from '../../src/input-state.js';
import { createScheduler } from '../../src/scheduler.js';
import { openStore } from '../../src/store.js';
import { createTelegram } from '../../src/telegram.js';
import { createUpdates } from '../../src/updates.js';
import type { Choice, DayState } from '../../src/types.js';
import { events, groupId } from '../fixtures/telegram-updates.js';
import { mockTelegram } from '../mocks/telegram.js';
export const schedule = { zone: 'Europe/Belgrade', openMinute: 540, closeMinute: 600, reminderMinute: 840 };
export const at = (time: string, day = '2026-09-30') => new Date(`${day}T${time}:00+02:00`);
export function harness(path = ':memory:', chooseIndex = (_size: number) => 0) {
  const store = openStore(path); const mock = mockTelegram(); const event = events();
  const telegram = createTelegram('123456:dummy_dummy_dummy', { transformer: mock.transformer });
  const delivery = createDelivery(store);
  const username = 'office_test_bot';
  const flipperNames = (id: number) => getFlipperName(store, id);
  const scheduler = createScheduler({ store, telegram, delivery, schedule, chooseIndex, chatId: groupId, flipperNames, username });
  const updates = createUpdates({ store, telegram, delivery, schedule, chatId: groupId, username, flipperNames });
  const day = () => store.get<DayState>('day:2026-09-30')!;
  const calls = (method: string) => mock.calls.filter(c => c.method === method);
  const register = (id: number, flipper = `F${id}`) => setFlipperName(store, id, flipper, id, at('09:00'));
  function press(action: Choice | 'discard', id: number, name?: string) {
    const cb = event.press('2026-09-30', action, id, day().signup!.messageId!, name).callback_query!;
    return applySignupPress(store, cb, at('09:30'), username, flipperNames);
  }
  // Compatibility with the poll-era scenarios: a "request" is a check-in, a "helper" is on duty.
  function vote(kind: 'request' | 'helper', id: number, option: number | null = 0, name?: string) {
    if (option !== 0) return press('discard', id, name);
    if (kind === 'request' && !flipperNames(id)) register(id);
    return press(kind === 'request' ? 'checkin' : 'duty', id, name);
  }
  async function close() { await scheduler.tick(at('10:00')); }
  return { store, mock, event, telegram, delivery, scheduler, updates, day, calls, flipperNames, register, press, vote, close };
}
