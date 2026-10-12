import { escapeHtml } from './messages.js';

// Every command the bot answers. All of them work in the private chat and none of them in the
// group: the group is for the sign-up message, the assignment and their buttons. A command
// outside this list is left alone, because it is probably addressed to another bot.
// Giving a dialog up is a button on the dialog itself, not a command.
export const COMMANDS = ['start', 'help', 'flipper', 'schedule', 'today', 'stats', 'history', 'test', 'admin'] as const;

// Shown for /start and /help, so nobody has to guess what exists.
export function privateHelp(admin: boolean): string {
  return ['Office badge check-ins. Sign-up opens at 09:00 and closes at 10:00, Monday–Friday (Europe/Belgrade); the buttons are on the sign-up message in the group.',
    ['Every command works here, in my private chat, and nowhere else:',
      '/flipper — set the name you are listed under in Flipper',
      '/schedule — sign yourself up for the next sign-up in advance',
      "/today — today's status",
      "/stats — this week's confirmed check-ins",
      "/stats month — this month's confirmed check-ins",
      '/history — recent confirmations',
      '/test — interactive test run in the group, with separate statistics',
      '/help — show this list',
      ...(admin ? ['/admin — commands for group admins'] : [])].join('\n'),
    "You're ready to receive a private reminder at 14:00 (Europe/Belgrade) if you're assigned badge duty and haven't confirmed it yet. Confirmations are self-reported.",
  ].join('\n\n');
}

export function privateOnlyNudge(command: string, botUsername: string): string {
  const bot = escapeHtml(botUsername);
  return `${command} only works in my private chat. Open <a href="https://t.me/${bot}">@${bot}</a>, press Start, then send ${command} there.`;
}
