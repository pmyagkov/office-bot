import type { Store } from './store.js';
import type { TelegramPort } from './telegram.js';
import type { Delivery } from './delivery.js';
import type { DayState, Schedule } from './types.js';
import { localTime, scheduledInstant } from './clock.js';
import { refreshAssignments } from './messages.js';
import { createFlow } from './flow.js';
export type Services = { store: Store; telegram: TelegramPort; delivery: Delivery; schedule: Schedule; chatId: number; chooseIndex: (size: number) => number; clock?: () => Date };
export function createScheduler(services: Services) {
  const { store, telegram, schedule, clock } = services;
  const flow = createFlow(services);
  const due = (day: DayState, now: Date) => now >= scheduledInstant(day.day, schedule.closeMinute, schedule.zone);
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
        if (['open', 'closing', 'incomplete'].includes(day.phase) && due(day, now)) await flow.closeDay(day);
        else await flow.publish(day, now);
        const reminderNow = clock?.() ?? now;
        const eligible = () => {
          const current = localTime(clock?.() ?? now, schedule.zone);
          return day.day === current.day && current.minute >= schedule.reminderMinute;
        };
        if (eligible()) await flow.remind(day, reminderNow, eligible);
      }
      await refreshAssignments(store, telegram, schedule.zone);
    },
    async finishClosing(now: Date): Promise<void> {
      for (const day of store.list<DayState>('day:')) if (due(day, now)) await flow.finishDay(day, now);
    },
  };
}
