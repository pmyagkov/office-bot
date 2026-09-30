import { afterEach, expect, it } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Update } from 'grammy/types';
import { harness, at } from './helpers/harness.js';
import { createRuntime } from '../src/runtime.js';
import { loadConfig } from '../src/config.js';
import { openStore } from '../src/store.js';
import type { DayState, Operation } from '../src/types.js';
import { fakeServer } from './fake-telegram-server.js';
import { events, groupId } from './fixtures/telegram-updates.js';
import { recoverOperation } from '../src/operations.js';
const instances: ReturnType<typeof harness>[] = [];
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { instances.splice(0).forEach(h => h.store.close()); for (const cleanup of cleanups.splice(0)) await cleanup(); });
const config = loadConfig({ TELEGRAM_BOT_TOKEN: '123456:dummy_dummy_dummy', TELEGRAM_CHAT_ID: String(groupId) });
it('runs an entire day through the production polling/input path', async () => {
  const h = harness(); instances.push(h); let now = at('09:00');
  const runtime = createRuntime({ ...config, heartbeat: '' }, h.store, h.telegram, () => now, 'office_test_bot');
  await runtime.step(); const request = h.day().polls.request!; const helper = h.day().polls.helper!;
  h.mock.updates.push(h.event.vote(request.id, 22, 1), h.event.vote(request.id, 22, 0), h.event.vote(helper.id, 11, 0));
  h.mock.polls.get(request.messageId)!.options[0].voter_count = 1; h.mock.polls.get(request.messageId)!.total_voter_count = 1;
  h.mock.polls.get(helper.messageId)!.options[0].voter_count = 1; h.mock.polls.get(helper.messageId)!.total_voter_count = 1;
  now = at('10:00'); await runtime.step(); expect(h.day().assignment?.recipients.map(p => p.id)).toEqual([22]);
  const click = h.event.click('2026-09-30', 11, h.day().assignment!.messageId!); h.mock.updates.push(click, click);
  now = at('13:59'); await runtime.step(); now = at('14:00'); await runtime.step();
  h.mock.updates.push(h.event.command('/stats')); await runtime.step();
  expect(h.calls('sendMessage').filter(c => c.payload.chat_id === 11)).toHaveLength(0);
  expect(h.calls('sendMessage').at(-1)?.payload.text).toContain('1 duties'); expect(h.calls('editMessageText')).toHaveLength(1);
  expect(h.store.get('offset')).toBe(6);
});
it('does not advance the cursor if applying an update fails', async () => {
  const h = harness(); instances.push(h); await h.scheduler.tick(at('09:00'));
  const original = h.store.set;
  h.store.set = (key, value) => { original(key, value); if (key === 'offset') throw Error('disk error'); };
  await expect(h.updates.handleUpdate(h.event.vote(h.day().polls.request!.id, 22, 0), at('09:30'))).rejects.toThrow('disk error');
  h.store.set = original;
  expect(h.store.get('offset')).toBeUndefined(); expect(h.day().polls.request?.votes).toEqual({});
});
it.each([false, true])('restores the assignment identity before a queued confirmation (operator resolution: %s)', async resolved => {
  const h = harness(); instances.push(h); await h.scheduler.tick(at('09:00')); h.vote('helper', 11); h.vote('request', 22); await h.close();
  const day = h.day(); day.assignment!.messageId = null; h.store.set(`day:${day.day}`, day);
  const messageId = resolved ? 42 : 3;
  if (resolved) {
    h.store.set('op:assignment:2026-09-30', { key: 'assignment:2026-09-30', status: 'uncertain' });
    recoverOperation(h.store, 'assignment:2026-09-30', 'resolve', messageId);
  }
  h.mock.updates.push(h.event.click('2026-09-30', 11, messageId));
  await createRuntime({ ...config, heartbeat: '' }, h.store, h.telegram, () => at('11:00'), 'office_test_bot').step();
  expect(h.day().assignment?.confirmedAt).toBe(at('11:00').toISOString());
  expect(h.calls('answerCallbackQuery').at(-1)?.payload.text).toContain('recorded');
  expect(h.calls('sendMessage')).toHaveLength(1);
});
async function processHarness() {
  const dir = mkdtempSync(join(tmpdir(), 'office-process-')); const database = join(dir, 'office.db');
  const server = await fakeServer(); const children: ChildProcess[] = [];
  cleanups.push(async () => { for (const child of children) if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await once(child, 'exit'); } await server.close(); rmSync(dir, { recursive: true }); });
  async function start() {
    const child = fork(new URL('./harness/bot-process.mjs', import.meta.url), { env: { PATH: process.env.PATH, TELEGRAM_BOT_TOKEN: config.token, TELEGRAM_CHAT_ID: String(groupId), DATABASE_PATH: database, HEARTBEAT_PATH: join(dir, 'heartbeat.json'), TEST_API_ROOT: server.apiRoot }, silent: true }); children.push(child);
    let stderr = ''; child.stderr!.on('data', data => { stderr += String(data); });
    const ready = await Promise.race([once(child, 'message'), once(child, 'exit').then(() => { throw Error(`Child exited: ${stderr}`); })]); expect(ready[0]).toEqual({ ready: true });
    return child;
  }
  async function step(child: ChildProcess, now: Date, responses: unknown[]) { server.responses.push(...responses); const response = once(child, 'message'); child.send({ now: now.toISOString() }); expect((await response)[0]).toEqual({ done: true }); }
  function read<T>(key: string) { const store = openStore(database); try { return store.get<T>(key); } finally { store.close(); } }
  async function stop(child: ChildProcess, signal: NodeJS.Signals = 'SIGKILL') { const exit = once(child, 'exit'); child.kill(signal); await exit; }
  return { server, start, step, read, stop };
}
const ok = (result: unknown) => ({ ok: true, result });
const poll = (id: string, voters = 0, closed = false) => ({ id, is_closed: closed, total_voter_count: voters, options: [{ text: 'Yes', persistent_id: '0', voter_count: voters }, { text: 'No', persistent_id: '1', voter_count: 0 }] });
it('restarts at published, assigned and confirmed phases; a lost edit retries without a second completion', async () => {
  const p = await processHarness(); const event = events(); let child = await p.start();
  await p.step(child, at('09:00'), [ok([]), ok({ message_id: 1, poll: poll('request') }), ok({ message_id: 2, poll: poll('helper') }), ok([])]); await p.stop(child);
  child = await p.start(); const votes: Update[] = [event.vote('request', 22, 0), event.vote('helper', 11, 0)];
  await p.step(child, at('10:00'), [ok(votes), ok([]), ok(poll('request', 1, true)), ok(poll('helper', 1, true)), ok([]), ok({ message_id: 3 })]);
  expect(p.read<DayState>('day:2026-09-30')?.assignment?.helper.id).toBe(11); await p.stop(child);
  child = await p.start();
  // The state commit happens before these idempotent edits, both fail here.
  const fail = { ok: false, error_code: 500, description: 'temporary error' };
  await p.step(child, at('11:00'), [ok([event.click('2026-09-30', 11, 3)]), ok(true), fail, ok([]), fail, ok([])]);
  const a = p.read<DayState>('day:2026-09-30')!.assignment!; expect(a.confirmedAt).toBe(at('11:00').toISOString()); expect(a.rendered).toBe(false); await p.stop(child);
  child = await p.start(); await p.step(child, at('14:00'), [ok([]), ok(true), ok([])]);
  expect(p.read<DayState>('day:2026-09-30')?.assignment?.rendered).toBe(true);
  expect(p.read('op:reminder:2026-09-30')).toBeUndefined(); expect(p.server.calls.filter(c => c.method === 'sendPoll')).toHaveLength(2);
  expect(p.server.calls.filter(c => c.method === 'sendMessage')).toHaveLength(1); await p.stop(child, 'SIGTERM');
});
it('does not repeat an accepted assignment whose HTTP response was lost across process restart', async () => {
  const p = await processHarness(); const event = events(); let child = await p.start();
  await p.step(child, at('09:00'), [ok([]), ok({ message_id: 1, poll: poll('request') }), ok({ message_id: 2, poll: poll('helper') }), ok([])]);
  await p.step(child, at('10:00'), [ok([event.vote('request', 22, 0), event.vote('helper', 11, 0)]), ok([]), ok(poll('request', 1, true)), ok(poll('helper', 1, true)), ok([]), 'disconnect']);
  await p.stop(child); child = await p.start(); await p.step(child, at('10:01'), [ok([]), ok([])]);
  expect(p.read<Operation>('op:assignment:2026-09-30')?.status).toBe('uncertain'); expect(p.server.calls.filter(c => c.method === 'sendMessage')).toHaveLength(1);
});
it('persists the one private reminder across a real process restart', async () => {
  const p = await processHarness(); const event = events(); let child = await p.start();
  await p.step(child, at('09:00'), [ok([]), ok({ message_id: 1, poll: poll('request') }), ok({ message_id: 2, poll: poll('helper') }), ok([])]);
  await p.step(child, at('10:00'), [ok([event.vote('request', 22, 0), event.vote('helper', 11, 0)]), ok([]), ok(poll('request', 1, true)), ok(poll('helper', 1, true)), ok([]), ok({ message_id: 3 })]);
  await p.step(child, at('14:00'), [ok([]), ok({ message_id: 4 }), ok([])]);
  await p.stop(child); child = await p.start(); await p.step(child, at('15:00'), [ok([]), ok([])]);
  expect(p.read<Operation>('op:reminder:2026-09-30')?.status).toBe('sent');
  expect(p.server.calls.filter(c => c.method === 'sendMessage' && c.payload.chat_id === 11)).toHaveLength(1);
});
