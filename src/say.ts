// `/admin say` — ported from squash-bot: free text to the office group, or a private message
// to one person, with a group nudge when that person cannot be reached privately.
import { escapeHtml } from './messages.js';
import type { Outgoing } from './replies.js';

export const SAY_USAGE = 'Usage: /admin say &lt;text&gt; or /admin say @username &lt;text&gt;';
export type SayCommand = { target?: string; message: string };
// The arguments of `/admin say …`, or undefined when the admin asked for something else.
export function sayArgs(args: string | undefined): string | undefined {
  const match = /^say(?:\s+([\s\S]*))?$/.exec((args ?? '').trim());
  return match ? match[1] ?? '' : undefined;
}

export function parseSay(raw: string | undefined): SayCommand | { error: string } {
  const args = (raw ?? '').trim();
  if (!args) return { error: SAY_USAGE };
  if (!args.startsWith('@')) return { message: args };
  const message = args.replace(/^\S+\s*/, '');
  if (!message) return { error: SAY_USAGE };
  return { target: args.split(/\s/)[0], message };
}

export function sayToGroup(groupChatId: number, adminId: number, message: string, markup?: Outgoing['markup']): Outgoing {
  return { chatId: groupChatId, pages: [escapeHtml(message)],
    onSent: { chatId: adminId, pages: ['Sent to the office group.'], markup },
    onFailed: { chatId: adminId, pages: ['Telegram rejected that message. Nothing was posted.'], markup } };
}

export function sayToPerson(targetId: number, adminId: number, target: string, message: string, groupChatId: number, botUsername: string, markup?: Outgoing['markup']): Outgoing {
  return { chatId: targetId, pages: [escapeHtml(message)],
    onSent: { chatId: adminId, pages: [`Sent to ${escapeHtml(target)}.`], markup },
    onFailed: nudgeInGroup(groupChatId, adminId, target, botUsername, UNREACHABLE_TARGET(target), markup) };
}

// Nobody can be written to privately before they press Start, so the group gets the nudge
// and the message itself is never repeated in public.
export function nudgeInGroup(groupChatId: number, adminId: number, target: string, botUsername: string, reason: string, markup?: Outgoing['markup']): Outgoing {
  const name = escapeHtml(target);
  return { chatId: groupChatId,
    pages: [`⚠️ I can't reach ${name} privately.\n\n${name}, please open @${escapeHtml(botUsername)} and press Start so I can write to you directly.`],
    onSent: { chatId: adminId, pages: [`${reason} I left a note in the office group instead.`], markup },
    onFailed: { chatId: adminId, pages: [`${reason} The office group rejected the note, too.`], markup } };
}

export const UNKNOWN_TARGET = (target: string) => `I don't know ${escapeHtml(target)} yet.`;
export const UNREACHABLE_TARGET = (target: string) => `${escapeHtml(target)} has not started a private chat with me.`;
