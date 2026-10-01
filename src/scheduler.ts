import type { Store } from './store.js';
import type { TelegramPort } from './telegram.js';
import type { Delivery } from './delivery.js';
import { isLegacy, type DayState, type Schedule } from './types.js';
import { localTime, scheduledInstant } from './clock.js';
import { refreshAssignments } from './messages.js';
import { refreshSignups } from './signup.js';
import { createFlow } from './flow.js';
export type Services = {
  store: Store; telegram: TelegramPort; delivery: Delivery; schedule: Schedule; chatId: number;
  chooseIndex: (size: number) => number; flipperNames: (id: number) => string | undefined; username?: string; clock?: () => Date;
};
export function createScheduler(services: Services) {
  const { store, telegram, schedule, clock } = services;
  const flow = createFlow(services);
  return {
    restoreDeliveries: flow.restoreDeliveries,
    async tick(now: Date): Promise<void> {
      flow.restoreDeliveries();
      const local = localTime(now, schedule.zone);
      const deadline = scheduledInstant(local.day, schedule.closeMinute, schedule.zone);
      if (local.weekday <= 5 && local.minute >= schedule.openMinute && deadline.getTime() - now.getTime() >= 5_000) {
        await flow.openDay(local.day, deadline, now);
      }
      for (const day of store.list<DayState>('day:')) {
        if (isLegacy(day) || !day.signup) continue;
        if (day.phase === 'open') { if (now.getTime() >= Date.parse(day.signup.closesAt)) await flow.closeDay(day, now); }
        else await flow.publish(day, now);
        const reminderNow = clock?.() ?? now;
        const eligible = () => {
          const current = localTime(clock?.() ?? now, schedule.zone);
          return day.day === current.day && current.minute >= schedule.reminderMinute;
        };
        if (eligible()) await flow.remind(day, reminderNow, eligible);
      }
      await refreshSignups(store, telegram, schedule.zone);
      await refreshAssignments(store, telegram, schedule.zone);
    },
  };
}
