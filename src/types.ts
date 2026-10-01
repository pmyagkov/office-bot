export type DayKey = string;
export type PollKind = 'request' | 'helper';
export const pollKinds: PollKind[] = ['request', 'helper'];
export type Participant = { id: number; name: string; username?: string; flipperName?: string };
export type Choice = 'checkin' | 'duty';
export type Signup = {
  messageId: number | null; closesAt: string;
  choices: Record<string, { user: Participant; choice: Choice }>; rendered?: string;
};
export type LocalTime = { day: DayKey; weekday: number; minute: number };
export type Schedule = { zone: string; openMinute: number; closeMinute: number; reminderMinute: number };
export type Assignment = {
  day: DayKey; chatId: number; helper: Participant; recipients: Participant[];
  messageId: number | null; confirmedAt: string | null; rendered: boolean; onDuty?: Participant[];
};
export type PollSnapshot = {
  id: string; messageId: number; closed: boolean; optionCounts: number[]; totalVoters: number;
};
export type PollState = PollSnapshot & { votes: Record<string, { user: Participant; option: number | null }> };
export type DayState = {
  day: DayKey; chatId: number; phase: 'open' | 'closing' | 'assigned' | 'empty' | 'no_helpers' | 'incomplete';
  polls: Partial<Record<PollKind, PollState>>; signup?: Signup; assignment?: Assignment; issue?: string;
};
export type SendResult<T> = { kind: 'sent'; value: T } |
  { kind: 'rejected'; code: number; retryAfter?: number } | { kind: 'uncertain' };
export type Operation<T = unknown> = {
  key: string; status: 'prepared' | 'sending' | 'sent' | 'rejected' | 'uncertain';
  value?: T; code?: number; retryAt?: string; updatedAt: string;
};
