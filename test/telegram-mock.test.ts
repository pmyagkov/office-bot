import { expect, it, vi } from 'vitest';
import { mockTelegram } from './mocks/telegram.js';
it('fails closed on unsupported methods without invoking the network', async () => {
  const mock = mockTelegram(); const network = vi.fn();
  await expect(mock.transformer(network, 'deleteMessage', { chat_id: 1, message_id: 1 })).rejects.toThrow('Unexpected Telegram method');
  expect(network).not.toHaveBeenCalled();
});
it('answers getChatMember from the members map and reports unknown users as 400', async () => {
  const mock = mockTelegram(); const network = vi.fn();
  mock.members.set(7, 'member');
  expect(await mock.transformer(network, 'getChatMember', { chat_id: -1, user_id: 7 })).toEqual({ ok: true, result: { status: 'member', user: { id: 7, is_bot: false, first_name: 'Person 7' } } });
  expect(await mock.transformer(network, 'getChatMember', { chat_id: -1, user_id: 8 })).toEqual({ ok: false, error_code: 400, description: 'Bad Request: user not found' });
  expect(network).not.toHaveBeenCalled();
});
