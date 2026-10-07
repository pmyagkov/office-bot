import { escapeHtml } from './messages.js';

// Commands that only make sense one-to-one: a dialog, a personal setting or admin work.
// Typed in the group they used to do nothing at all, which is why people kept typing them there.
export const PRIVATE_ONLY = ['start', 'flipper', 'schedule', 'cancel', 'admin'] as const;
export const GROUP_COMMANDS = '/today, /stats, /stats month, /history, /test, /help';

// Shown for /start and /help in the private chat, so nobody has to guess what exists.
export function privateHelp(admin: boolean): string {
  return ['Office badge check-ins. Sign-up opens at 09:00 and closes at 10:00, Monday–Friday (Europe/Belgrade); the buttons are on the sign-up message in the group.',
    ['Here, in my private chat:',
      '/flipper — set the name you are listed under in Flipper',
      '/schedule — sign yourself up for the next sign-up in advance',
      '/cancel — stop whatever dialog is running',
      '/help — show this list',
      ...(admin ? ['/admin — commands for group admins'] : [])].join('\n'),
    ['In the office group:',
      "/today — today's status",
      "/stats — this week's confirmed check-ins",
      "/stats month — this month's confirmed check-ins",
      '/history — recent confirmations',
      '/test — interactive test run with separate statistics'].join('\n'),
    "You're ready to receive a private reminder at 14:00 (Europe/Belgrade) if you're assigned badge duty and haven't confirmed it yet. Confirmations are self-reported.",
  ].join('\n\n');
}

export function privateOnlyNudge(command: string, botUsername: string): string {
  const bot = escapeHtml(botUsername);
  return `${command} only works in my private chat. Open <a href="https://t.me/${bot}">@${bot}</a>, press Start, then send ${command} there.\n\nHere in the group: ${GROUP_COMMANDS}.`;
}
