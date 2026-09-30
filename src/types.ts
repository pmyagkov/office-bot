export type DayKey = string;
export type PollKind = 'request' | 'helper';
export const pollKinds: PollKind[] = ['request', 'helper'];
export type Participant = { id: number; name: string; username?: string };
export type LocalTime = { day: DayKey; weekday: number; minute: number };
export type Schedule = { zone: string; openMinute: number; closeMinute: number; reminderMinute: number };
export type Assignment = {
  day: DayKey; chatId: number; helper: Participant; recipients: Participant[];
  messageId: number | null; confirmedAt: string | null; rendered: boolean;
};
export type PollSnapshot = {
  id: string; messageId: number; closed: boolean; optionCounts: number[]; totalVoters: number;
};
export type PollState = PollSnapshot & { votes: Record<string, { user: Participant; option: number | null }> };
export type DayState = {
  day: DayKey; chatId: number; phase: 'open' | 'closing' | 'assigned' | 'empty' | 'no_helpers' | 'incomplete';
  polls: Partial<Record<PollKind, PollState>>; assignment?: Assignment; issue?: string;
};
export type SendResult<T> = { kind: 'sent'; value: T } |
  { kind: 'rejected'; code: number; retryAfter?: number } | { kind: 'uncertain' };
export type Operation<T = unknown> = {
  key: string; status: 'prepared' | 'sending' | 'sent' | 'rejected' | 'uncertain';
  value?: T; code?: number; retryAt?: string; updatedAt: string;
};
