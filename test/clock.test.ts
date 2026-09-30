import { describe, it, expect } from 'vitest';
import { localTime, scheduledInstant, reportStart } from '../src/clock.js';

describe('Belgrade schedule', () => {
  it.each([
    ['2026-09-30T07:00:00Z', '2026-09-30', 3, 540],
    ['2026-12-01T08:00:00Z', '2026-12-01', 2, 540],
    ['2026-10-25T08:00:00Z', '2026-10-25', 7, 540],
  ])('converts %s to local schedule time', (utc, day, weekday, minute) => {
    expect(localTime(new Date(utc), 'Europe/Belgrade')).toEqual({ day, weekday, minute });
  });
  it('gives Telegram the correct absolute closing deadline across DST', () => {
    expect(scheduledInstant('2026-09-30', 600, 'Europe/Belgrade').toISOString()).toBe('2026-09-30T08:00:00.000Z');
    expect(scheduledInstant('2026-12-01', 600, 'Europe/Belgrade').toISOString()).toBe('2026-12-01T09:00:00.000Z');
  });
  it('calculates reporting boundaries across a year', () => {
    expect(reportStart('2027-01-01', 'week')).toBe('2026-12-28');
    expect(reportStart('2027-01-01', 'month')).toBe('2027-01-01');
  });
});
