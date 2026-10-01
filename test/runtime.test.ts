import { afterEach, expect, it } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { harness, at } from './helpers/harness.js';
import { createRuntime } from '../src/runtime.js';
import { loadConfig } from '../src/config.js';
import { openStore } from '../src/store.js';
import { setFlipperName } from '../src/flipper.js';
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
  await runtime.step(); const signup = h.day().signup!.messageId!; h.register(22); h.register(11);
  h.mock.updates.push(h.event.press('2026-09-30', 'duty', 22, signup), h.event.press('2026-09-30', 'checkin', 22, signup), h.event.press('2026-09-30', 'duty', 11, signup));
  now = at('09:30'); await runtime.step();
  now = at('10:00'); await runtime.step(); expect(h.day().assignment?.recipients.map(p => p.id)).toEqual([22]);
  const assignment = h.day().assignment!.messageId!; const click = h.event.click('2026-09-30', 11, assignment); h.mock.updates.push(click, click);
  now = at('13:59'); await runtime.step(); now = at('14:00'); await runtime.step();
  h.mock.updates.push(h.event.command('/stats')); await runtime.step();
  expect(h.calls('sendMessage').filter(c => c.payload.chat_id === 11)).toHaveLength(0);
  expect(h.calls('sendMessage').at(-1)?.payload.text).toContain('1 duties');
  expect(h.calls('editMessageText').filter(c => c.payload.message_id === assignment)).toHaveLength(1);
  expect(h.store.get('offset')).toBe(6);
});
it('does not advance the cursor if applying an update fails', async () => {
  const h = harness(); instances.push(h); await h.scheduler.tick(at('09:00'));
  const original = h.store.set;
  h.store.set = (key, value) => { original(key, value); if (key === 'offset') throw Error('disk error'); };
  await expect(h.updates.handleUpdate(h.event.press('2026-09-30', 'duty', 22, h.day().signup!.messageId!), at('09:30'))).rejects.toThrow('disk error');
  h.store.set = original;
  expect(h.store.get('offset')).toBeUndefined(); expect(h.day().signup?.choices).toEqual({});
});
it.each([false, true])('restores the assignment identity before a queued confirmation (operator resolution: %s)', async resolved => {
  const h = harness(); instances.push(h); await h.scheduler.tick(at('09:00')); h.vote('helper', 11); h.vote('request', 22); await h.close();
  const day = h.day(); day.assignment!.messageId = null; h.store.set(`day:${day.day}`, day);
  const messageId = resolved ? 42 : 2;
  if (resolved) {
    h.store.set('op:assignment:2026-09-30', { key: 'assignment:2026-09-30', status: 'uncertain' });
    recoverOperation(h.store, 'assignment:2026-09-30', 'resolve', messageId);
  }
  h.mock.updates.push(h.event.click('2026-09-30', 11, messageId));
  await createRuntime({ ...config, heartbeat: '' }, h.store, h.telegram, () => at('11:00'), 'office_test_bot').step();
  expect(h.day().assignment?.confirmedAt).toBe(at('11:00').toISOString());
  expect(h.calls('answerCallbackQuery').at(-1)?.payload.text).toContain('recorded');
  expect(h.calls('sendMessage')).toHaveLength(2);
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
  async function step(child: ChildProcess, now: Date, responses: unknown[]) { server.responses.push(...responses); const response = once(child, 'message'); child.send({ now: now.toISOString() }); expect((await response)[0]).toEqual({ done: true }); expect(server.responses).toEqual([]); }
  function read<T>(key: string) { const store = openStore(database); try { return store.get<T>(key); } finally { store.close(); } }
  function register(id: number) { const store = openStore(database); try { setFlipperName(store, id, `F${id}`, id, at('09:00')); } finally { store.close(); } }
  async function stop(child: ChildProcess, signal: NodeJS.Signals = 'SIGKILL') { const exit = once(child, 'exit'); child.kill(signal); await exit; }
  return { server, start, step, read, register, stop };
}
const ok = (result: unknown) => ({ ok: true, result });
// 09:00 publishes the sign-up message (id 1); 09:30 records a check-in by 22 and duty by 11, each press re-renders the message.
async function signUp(p: Awaited<ReturnType<typeof processHarness>>, child: ChildProcess, event: ReturnType<typeof events>) {
  await p.step(child, at('09:00'), [ok([]), ok({ message_id: 1 })]); p.register(22);
  await p.step(child, at('09:30'), [ok([event.press('2026-09-30', 'checkin', 22, 1), event.press('2026-09-30', 'duty', 11, 1)]), ok(true), ok(true), ok(true), ok(true), ok([])]);
}
it('restarts at published, assigned and confirmed phases; a lost edit retries without a second completion', async () => {
  const p = await processHarness(); const event = events(); let child = await p.start();
  await p.step(child, at('09:00'), [ok([]), ok({ message_id: 1 })]); await p.stop(child);
  child = await p.start(); p.register(22);
  await p.step(child, at('09:30'), [ok([event.press('2026-09-30', 'checkin', 22, 1), event.press('2026-09-30', 'duty', 11, 1)]), ok(true), ok(true), ok(true), ok(true), ok([])]);
  await p.step(child, at('10:00'), [ok([]), ok(true), ok({ message_id: 2 })]);
  expect(p.read<DayState>('day:2026-09-30')?.assignment?.helper.id).toBe(11); await p.stop(child);
  child = await p.start();
  // The state commit happens before these idempotent edits, both fail here.
  const fail = { ok: false, error_code: 500, description: 'temporary error' };
  await p.step(child, at('11:00'), [ok([event.click('2026-09-30', 11, 2)]), ok(true), fail, ok([]), fail]);
  const a = p.read<DayState>('day:2026-09-30')!.assignment!; expect(a.confirmedAt).toBe(at('11:00').toISOString()); expect(a.rendered).toBe(false); await p.stop(child);
  child = await p.start(); await p.step(child, at('14:00'), [ok([]), ok(true)]);
  expect(p.read<DayState>('day:2026-09-30')?.assignment?.rendered).toBe(true); expect(p.read('op:reminder:2026-09-30')).toBeUndefined();
  expect(p.server.calls.filter(c => c.method === 'sendMessage')).toHaveLength(2); await p.stop(child, 'SIGTERM');
});
it('does not repeat an accepted assignment whose HTTP response was lost across process restart', async () => {
  const p = await processHarness(); const event = events(); let child = await p.start(); await signUp(p, child, event);
  await p.step(child, at('10:00'), [ok([]), ok(true), 'disconnect']);
  await p.stop(child); child = await p.start(); await p.step(child, at('10:01'), [ok([])]);
  expect(p.read<Operation>('op:assignment:2026-09-30')?.status).toBe('uncertain'); expect(p.server.calls.filter(c => c.method === 'sendMessage')).toHaveLength(2);
});
it('persists the one private reminder across a real process restart', async () => {
  const p = await processHarness(); const event = events(); let child = await p.start(); await signUp(p, child, event);
  await p.step(child, at('10:00'), [ok([]), ok(true), ok({ message_id: 2 })]);
  await p.step(child, at('14:00'), [ok([]), ok({ message_id: 3 })]);
  await p.stop(child); child = await p.start(); await p.step(child, at('15:00'), [ok([])]);
  expect(p.read<Operation>('op:reminder:2026-09-30')?.status).toBe('sent');
  expect(p.server.calls.filter(c => c.method === 'sendMessage' && c.payload.chat_id === 11)).toHaveLength(1);
});
