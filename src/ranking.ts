import type { DayKey, DayState, Participant } from './types.js';

export const FAIRNESS_WINDOW_DAYS = 60;
const EPSILON = 1e-9;

function windowStart(today: DayKey): DayKey {
  const [year, month, day] = today.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day - FAIRNESS_WINDOW_DAYS)).toISOString().slice(0, 10);
}

export function dutyCredits(days: DayState[], today: DayKey): Map<number, number> {
  const start = windowStart(today);
  const credits = new Map<number, number>();
  for (const state of days) {
    const assignment = state.assignment;
    if (state.phase !== 'assigned' || !assignment?.onDuty?.length) continue;
    if (state.day < start || state.day >= today) continue;
    const share = 1 / assignment.onDuty.length;
    for (const user of assignment.onDuty) credits.set(user.id, (credits.get(user.id) ?? 0) + share);
    credits.set(assignment.helper.id, (credits.get(assignment.helper.id) ?? 0) - 1);
  }
  return credits;
}

export function chooseHelper(
  onDuty: Participant[], days: DayState[], today: DayKey, chooseIndex: (size: number) => number,
): Participant {
  const credits = dutyCredits(days, today);
  const candidates = [...onDuty].sort((a, b) => a.id - b.id);
  const creditOf = (user: Participant) => credits.get(user.id) ?? 0;
  const best = Math.max(...candidates.map(creditOf));
  const tied = candidates.filter((user) => creditOf(user) >= best - EPSILON);
  return tied[chooseIndex(tied.length)];
}
