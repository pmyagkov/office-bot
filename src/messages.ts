import type { InlineKeyboardMarkup } from 'grammy/types';
import type { Assignment, Participant } from './types.js';
import { isLegacy, type DayState } from './types.js';
import type { Store } from './store.js';
import type { TelegramPort } from './telegram.js';
export const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export const displayName = (user: Participant) => Array.from(user.name.trim()).slice(0, 100).join('') || `User ${user.id}`;
export const mention = (user: Participant) => `<a href="tg://user?id=${user.id}">${escapeHtml(displayName(user))}</a>`;
export const tag = (user: Participant) => user.username ? `@${escapeHtml(user.username)}` : mention(user);
export function clockLabel(iso: string, zone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}
export function names(people: Participant[], budget = 2500): string {
  const parts: string[] = []; let length = 0;
  for (const person of people) {
    const part = mention(person);
    if (length + part.length > budget) break;
    parts.push(part); length += part.length + 2;
  }
  return parts.join(', ') + (parts.length < people.length ? ` … and ${people.length - parts.length} more (see /today for the full list).` : '');
}
// Recipients are listed by their frozen Flipper name and never tagged.
export const recipientLine = (user: Participant) => `• ${escapeHtml(user.flipperName ?? displayName(user))}`;
export function recipientLines(people: Participant[], budget = 2500): string {
  const lines: string[] = []; let length = 0;
  for (const person of people) {
    const line = recipientLine(person);
    if (length + line.length > budget) break;
    lines.push(line); length += line.length + 1;
  }
  return lines.join('\n') + (lines.length < people.length ? `\n… and ${people.length - lines.length} more (see /today for the full list).` : '');
}
export function confirmKeyboard(day: string): InlineKeyboardMarkup {
  return { inline_keyboard: [[{ text: "I've checked everyone in", callback_data: `done:${day}` }]] };
}
export function confirmationTime(iso: string, zone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: zone, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}
export function assignmentMessage(a: Assignment, zone: string): string {
  const text = `🎉 ${tag(a.helper)}, you're on badge duty today!\n\nPlease check in:\n${recipientLines(a.recipients)}\n\nAssignment date: ${a.day}.`;
  return a.confirmedAt ? `${text}\n\n✅ Confirmed ${clockLabel(a.confirmedAt, zone)}` : text;
}
export async function refreshAssignments(store: Store, telegram: TelegramPort, zone: string): Promise<void> {
  for (const day of store.list<DayState>('day:')) {
    const a = day.assignment; if (isLegacy(day) || !a?.confirmedAt || !a.messageId || a.rendered) continue;
    try {
      await telegram.editMessage(a.chatId, a.messageId, assignmentMessage(a, zone));
      a.rendered = true; store.set(`day:${day.day}`, day);
    } catch { /* Retry this idempotent edit on the next tick. */ }
  }
}
