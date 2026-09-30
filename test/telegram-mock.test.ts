import { expect, it, vi } from 'vitest';
import { mockTelegram } from './mocks/telegram.js';
it('fails closed on unsupported methods without invoking the network', async () => {
  const mock = mockTelegram(); const network = vi.fn();
  await expect(mock.transformer(network, 'deleteMessage', { chat_id: 1, message_id: 1 })).rejects.toThrow('Unexpected Telegram method');
  expect(network).not.toHaveBeenCalled();
});
