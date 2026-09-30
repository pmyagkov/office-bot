import { afterEach, expect, it } from 'vitest';
import { createTelegram } from '../src/telegram.js';
import { fakeServer } from './fake-telegram-server.js';
const servers: Awaited<ReturnType<typeof fakeServer>>[] = [];
afterEach(async () => { for (const s of servers.splice(0)) await s.close(); });
async function setup() { const server = await fakeServer(); servers.push(server); return { server, telegram: createTelegram('123456:dummy_dummy_dummy', { apiRoot: server.apiRoot }) }; }
it('uses real HTTP for polls with English copy, public votes and a fixed deadline', async () => {
  const { server, telegram } = await setup();
  server.responses.push({ ok: true, result: { message_id: 7, poll: { id: 'p1', is_closed: false, total_voter_count: 0, options: [{ voter_count: 0 }, { voter_count: 0 }] } } });
  expect(await telegram.sendPoll(-100123, 'request', '2026-09-30', new Date('2026-09-30T08:00:00Z'))).toMatchObject({ kind: 'sent', value: { id: 'p1', messageId: 7 } });
  expect(server.calls[0]).toMatchObject({ method: 'sendPoll', payload: { chat_id: -100123, question: 'Who needs to be checked in today? (2026-09-30)', options: [{ text: 'I do' }, { text: 'Not today' }], is_anonymous: false, allows_multiple_answers: false, close_date: 1790755200 } });
});
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
  expect(server.calls[0].payload).toMatchObject({ offset: 100, allowed_updates: ['message', 'poll', 'poll_answer', 'callback_query'] });
  expect(server.calls[1].payload).toMatchObject({ reply_markup: { inline_keyboard: [] }, parse_mode: 'HTML' });
});
