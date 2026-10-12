import { expect, it } from 'vitest';
import { createTelegram } from '../src/telegram.js';
import { mockTelegram } from './mocks/telegram.js';

// Telegram's own command menu is what most people tap, so the group must offer nothing at all.
it('publishes separate command menus for private chats and for groups', async () => {
  const mock = mockTelegram();
  const telegram = createTelegram('123456:dummy_dummy_dummy', { transformer: mock.transformer });
  await telegram.publishCommands();
  const published = mock.calls.filter(c => c.method === 'setMyCommands').map(c => ({
    scope: (c.payload.scope as { type: string }).type,
    commands: (c.payload.commands as { command: string }[]).map(entry => entry.command),
  }));
  expect(published).toEqual([
    { scope: 'all_private_chats', commands: ['start', 'help', 'flipper', 'schedule', 'today', 'stats', 'history', 'test', 'cancel'] },
    { scope: 'all_group_chats', commands: [] },
  ]);
});
