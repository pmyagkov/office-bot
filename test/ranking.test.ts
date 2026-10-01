import { describe, expect, it } from 'vitest';
import { chooseHelper, dutyCredits, FAIRNESS_WINDOW_DAYS } from '../src/ranking.js';
import type { DayKey, DayState, Participant } from '../src/types.js';

const person = (id: number): Participant => ({ id, name: `User ${id}` });
const dayKey = (offset: number, base = Date.UTC(2026, 7, 1)): DayKey =>
  new Date(base + offset * 86_400_000).toISOString().slice(0, 10);

function assigned(day: DayKey, onDuty: number[] | undefined, helperId: number): DayState {
  return {
    day, chatId: 1, phase: 'assigned', polls: {},
    assignment: {
      day, chatId: 1, helper: person(helperId), recipients: [], messageId: null,
      confirmedAt: null, rendered: false, onDuty: onDuty?.map(person),
    },
  };
}

const today = '2026-10-01';
const daysAgo = (n: number) => dayKey(-n, Date.UTC(2026, 9, 1));

describe('fair-share ranking', () => {
  it('gives a newcomer zero credit and credits sum to zero per day', () => {
    const credits = dutyCredits([assigned(daysAgo(1), [1, 2, 3], 1)], today);
    expect(credits.get(1)).toBeCloseTo(1 / 3 - 1, 12);
    expect(credits.get(2)).toBeCloseTo(1 / 3, 12);
    expect(credits.get(3)).toBeCloseTo(1 / 3, 12);
    expect([...credits.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(0, 12);
    expect(credits.get(99) ?? 0).toBe(0);
  });

  it('picks the highest credit', () => {
    const days = [assigned(daysAgo(1), [1, 2, 3], 1)];
    expect(chooseHelper([person(1), person(2), person(3)], days, today, () => 0).id).toBe(2);
    expect(chooseHelper([person(1), person(2), person(3)], days, today, (size) => size - 1).id).toBe(3);
  });

  it('breaks exact ties with chooseIndex over id-sorted candidates', () => {
    const sizes: number[] = [];
    const picked = chooseHelper([person(3), person(1), person(2)], [], today, (size) => {
      sizes.push(size);
      return 2;
    });
    expect(sizes).toEqual([3]);
    expect(picked.id).toBe(3);
  });

  it('normalises by availability', () => {
    // daily volunteer 1 is present every day, weekly volunteer 2 one day in five.
    const days: DayState[] = [];
    const duties = new Map<number, number>();
    const total = 20;
    for (let i = 0; i < total; i++) {
      const onDuty = i % 5 === 4 ? [person(1), person(2)] : [person(1)];
      const helper = chooseHelper(onDuty, days, dayKey(i), () => 0);
      duties.set(helper.id, (duties.get(helper.id) ?? 0) + 1);
      days.push(assigned(dayKey(i), onDuty.map((p) => p.id), helper.id));
    }
    const expected1 = 16 + 4 * 0.5;
    const expected2 = 4 * 0.5;
    expect(Math.abs((duties.get(1) ?? 0) - expected1)).toBeLessThanOrEqual(1);
    expect(Math.abs((duties.get(2) ?? 0) - expected2)).toBeLessThanOrEqual(1);
  });

  it('ignores days outside the 60-day window, today, days without onDuty (legacy) and non-assigned phases', () => {
    expect(FAIRNESS_WINDOW_DAYS).toBe(60);
    const stale: DayState = { ...assigned(daysAgo(1), [1, 2], 1), phase: 'incomplete' };
    const days = [
      assigned(daysAgo(61), [1, 2], 1),
      assigned(today, [1, 2], 1),
      assigned(daysAgo(2), undefined, 1),
      stale,
    ];
    expect(dutyCredits(days, today).size).toBe(0);
    const edge = dutyCredits([assigned(daysAgo(60), [1, 2], 1)], today);
    expect(edge.get(1)).toBeCloseTo(-0.5, 12);
    expect(edge.get(2)).toBeCloseTo(0.5, 12);
  });

  it('does not treat float noise as a difference', () => {
    const days: DayState[] = [];
    for (let i = 1; i <= 30; i++) days.push(assigned(daysAgo(i), [1, 2, 3], ((i - 1) % 3) + 1));
    const sizes: number[] = [];
    chooseHelper([person(1), person(2), person(3)], days, today, (size) => {
      sizes.push(size);
      return 0;
    });
    expect(sizes).toEqual([3]);
  });
});
