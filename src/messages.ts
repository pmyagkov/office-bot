import type { InlineKeyboardMarkup } from 'grammy/types';
import type { Assignment, Participant } from './types.js';
export const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export const mention = (user: Participant) => `<a href="tg://user?id=${user.id}">${escapeHtml(user.name.slice(0, 100))}</a>`;
export function names(people: Participant[], budget = 2500): string {
  const parts: string[] = []; let length = 0;
  for (const person of people) {
    const part = mention(person);
    if (length + part.length > budget) break;
    parts.push(part); length += part.length + 2;
  }
  return parts.join(', ') + (parts.length < people.length ? ` … and ${people.length - parts.length} more (see /today for the full list).` : '');
}
export function confirmKeyboard(day: string): InlineKeyboardMarkup {
  return { inline_keyboard: [[{ text: "I've checked everyone in", callback_data: `done:${day}` }]] };
}
export function confirmationTime(iso: string, zone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: zone, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}
export function assignmentMessage(a: Assignment, zone: string): string {
  if (a.confirmedAt) return `✅ ${mention(a.helper)} confirmed check-ins for: ${names(a.recipients)}.\n\nConfirmed on ${confirmationTime(a.confirmedAt, zone)} (${escapeHtml(zone)}).\nAssignment date: ${a.day}.`;
  return `🎉 ${mention(a.helper)}, you won! You're on badge duty today.\n\nPlease check in: ${names(a.recipients)}.\n\nAssignment date: ${a.day}.`;
}
