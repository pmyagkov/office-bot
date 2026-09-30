import type { DayKey, LocalTime } from './types.js';

export function localTime(now: Date, zone: string): LocalTime {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(p => [p.type, p.value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  return { day, weekday: new Date(`${day}T12:00:00Z`).getUTCDay() || 7,
    minute: Number(parts.hour) * 60 + Number(parts.minute) };
}

export function scheduledInstant(day: DayKey, minute: number, zone: string): Date {
  const target = Date.parse(`${day}T00:00:00Z`) + minute * 60_000;
  let result = target;
  for (let i = 0; i < 3; i++) {
    const local = localTime(new Date(result), zone);
    result += target - (Date.parse(`${local.day}T00:00:00Z`) + local.minute * 60_000);
  }
  return new Date(result);
}

export function reportStart(day: DayKey, period: 'week' | 'month'): DayKey {
  if (period === 'month') return `${day.slice(0, 7)}-01`;
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() || 7) - 1));
  return date.toISOString().slice(0, 10);
}
