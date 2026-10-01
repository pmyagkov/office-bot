import { afterEach, expect, it } from 'vitest';
import { createTelegram } from '../src/telegram.js';
import { fakeServer } from './fake-telegram-server.js';
const servers: Awaited<ReturnType<typeof fakeServer>>[] = [];
afterEach(async () => { for (const s of servers.splice(0)) await s.close(); });
async function setup() { const server = await fakeServer(); servers.push(server); return { server, telegram: createTelegram('123456:dummy_dummy_dummy', { apiRoot: server.apiRoot }) }; }
it('classifies permission errors, flood limits and ambiguous connection loss', async () => {
  const { server, telegram } = await setup();
  server.responses.push({ ok: false, error_code: 403, description: 'Forbidden' }, { ok: false, error_code: 429, description: 'Too many requests', parameters: { retry_after: 30 } }, 'disconnect');
  expect(await telegram.sendMessage(1, 'hello')).toEqual({ kind: 'rejected', code: 403 });
  expect(await telegram.sendMessage(1, 'hello')).toEqual({ kind: 'rejected', code: 429, retryAfter: 30 });
  expect(await telegram.sendMessage(1, 'hello')).toEqual({ kind: 'uncertain' });
  expect(server.calls).toHaveLength(3);
});
it('retrieves only required updates and uses safe edits and callback answers', async () => {
  const { server, telegram } = await setup();
  expect(await telegram.getUpdates(100, 0)).toEqual([]);
  server.responses.push({ ok: false, error_code: 400, description: 'Bad Request: message is not modified' }, { ok: true, result: true });
  await telegram.editMessage(-1001, 30, 'Done'); await telegram.answerCallback('click', 'Recorded');
  expect(server.calls[0].payload).toMatchObject({ offset: 100, allowed_updates: ['message', 'callback_query'] });
  expect(server.calls[1].payload).toMatchObject({ reply_markup: { inline_keyboard: [] }, parse_mode: 'HTML' });
});
it('getMemberStatus returns the status, null for an unknown member and throws for other errors', async () => {
  const { server, telegram } = await setup();
  server.responses.push({ ok: true, result: { status: 'administrator', user: { id: 1, is_bot: false, first_name: 'A' } } },
    { ok: false, error_code: 400, description: 'Bad Request: user not found' },
    { ok: false, error_code: 500, description: 'Internal error at https://api.telegram.org/bot123456:secret' });
  expect(await telegram.getMemberStatus(-1001, 1)).toBe('administrator');
  expect(await telegram.getMemberStatus(-1001, 2)).toBeNull();
  await expect(telegram.getMemberStatus(-1001, 3)).rejects.toThrow(new Error('Unable to read chat member'));
  expect(server.calls[0]).toMatchObject({ method: 'getChatMember', payload: { chat_id: -1001, user_id: 1 } });
});
it('answers callbacks with an optional url', async () => {
  const { server, telegram } = await setup();
  await telegram.answerCallback('click', 'Open', 'https://t.me/office_test_bot?start=x');
  await telegram.answerCallback('click', 'Recorded');
  expect(server.calls[0].payload).toMatchObject({ callback_query_id: 'click', text: 'Open', url: 'https://t.me/office_test_bot?start=x' });
  expect(server.calls[1].payload).not.toHaveProperty('url');
});
