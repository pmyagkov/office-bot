import type { Store } from './store.js';
import type { Assignment, Choice, DayState, Operation, Participant } from './types.js';
import { reportStart } from './clock.js';
import { assignmentMessage, clockLabel, confirmationTime, escapeHtml, mention, names, recipientLine, recipientLines } from './messages.js';
const completed = (store: Store) => store.list<DayState>('day:').flatMap(d => d.assignment?.confirmedAt ? [d.assignment] : []);
function bounded(lines: string[]): string {
  let result = '';
  for (const line of lines) {
    if (result.length + line.length > 3750) return `${result}\n… More entries are available in the database export.`;
    result += `${line}\n`;
  }
  return result.trimEnd();
}
export function renderStats(store: Store, day: string, period: 'week' | 'month'): string {
  const start = reportStart(day, period);
  const assignments = completed(store).filter(a => a.day >= start && a.day <= day);
  const rows = new Map<number, { person: Participant; duties: number; performed: number; received: number }>();
  function row(person: Participant) { const value = rows.get(person.id) ?? { person, duties: 0, performed: 0, received: 0 }; rows.set(person.id, value); return value; }
  for (const a of assignments) { const helper = row(a.helper); helper.duties++; helper.performed += a.recipients.length; for (const p of a.recipients) row(p).received++; }
  return bounded([`<b>Confirmed check-ins · ${start} to ${day}</b>`, ...(rows.size ? [...rows.values()].sort((a, b) => b.duties - a.duties || a.person.id - b.person.id).map(r => `${mention(r.person)}: ${r.duties} duties · ${r.performed} check-ins performed · ${r.received} received`) : ['No confirmed check-ins in this period.'])]);
}
export function renderHistory(store: Store, limit: number, zone: string): string {
  const all = completed(store).sort((a, b) => b.confirmedAt!.localeCompare(a.confirmedAt!)).slice(0, limit);
  return bounded(['<b>Recent confirmations</b>', ...(all.length ? all.map(a => `${a.day}: ${mention(a.helper)} → ${names(a.recipients, 1300)}\nConfirmed ${confirmationTime(a.confirmedAt!, zone)} (${escapeHtml(zone)})`) : ['No confirmations yet.'])]);
}
export function renderToday(store: Store, day: string, zone: string): string[] {
  const state = store.get<DayState>(`day:${day}`);
  if (!state) return [`${day}: No sign-up has been published today. Sign-up runs Monday–Friday, 09:00–10:00 (${escapeHtml(zone)}).`];
  const a: Assignment | undefined = state.assignment; const signup = state.signup;
  const count = (choice: Choice) => Object.values(signup?.choices ?? {}).filter(e => e.choice === choice).length;
  // 'closing', 'incomplete' and an open day without a sign-up only occur on legacy poll days.
  const status = state.phase === 'open' && signup ? `Sign-up is open until ${clockLabel(signup.closesAt, zone)}.\n${count('checkin')} need a check-in, ${count('duty')} on duty`
    : { open: 'Voting is open until 10:00.', closing: 'Closing polls and checking votes.', incomplete: 'Poll results are incomplete.', empty: 'No check-ins are needed today.', no_helpers: 'No helper volunteered today.', assigned: 'A helper has been selected.' }[state.phase];
  const issues = store.list<Operation>('op:').filter(op => op.key.includes(day) && op.status !== 'sent').map(op => `${escapeHtml(op.key)}: ${op.status}${op.code ? ` (Telegram ${op.code})` : ''}`);
  const header = `${day}: ${status}${state.issue ? `\n${escapeHtml(state.issue)}` : ''}${a ? `\n\n${assignmentMessage(a, zone)}\nStatus: ${a.confirmedAt ? 'Confirmed' : 'Awaiting confirmation'}.` : ''}${issues.length ? `\n\nDelivery status:\n${issues.join('\n')}` : ''}`;
  const pages = [header];
  // Every recipient stays accessible even when the assignment preview is shortened.
  if (a && recipientLines(a.recipients).includes('see /today')) {
    let page = '<b>Full recipient list</b>\n';
    for (const p of a.recipients) { const line = `${recipientLine(p)}\n`; if (page.length + line.length > 3500) { pages.push(page); page = ''; } page += line; }
    if (page) pages.push(page);
  }
  return pages;
}
