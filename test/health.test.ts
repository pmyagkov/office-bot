import { expect, it } from 'vitest';
import { fakeServer } from './fake-telegram-server.js';
import { fork, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { run } from '../src/main.js';
import { loadConfig } from '../src/config.js';
import { createTelegram } from '../src/telegram.js';
it('invalidates the previous heartbeat before attempting startup', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'office-startup-')); const heartbeat = join(dir, 'heartbeat.json');
  writeFileSync(heartbeat, JSON.stringify({ at: Date.now(), pid: process.pid }));
  const config = loadConfig({ TELEGRAM_BOT_TOKEN: '123456:dummy_dummy_dummy', TELEGRAM_CHAT_ID: '-100123', HEARTBEAT_PATH: heartbeat });
  const telegram = createTelegram(config.token, { transformer: async () => { throw Error('Unavailable'); } });
  try { await expect(run(config, telegram)).rejects.toThrow(); expect(existsSync(heartbeat)).toBe(false); }
  finally { rmSync(dir, { recursive: true }); }
});
it('runs the actual loop, reports health, redacts polling errors and shuts down gracefully', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'office-health-')); const server = await fakeServer(); const heartbeat = join(dir, 'heartbeat.json');
  const ok = (result: unknown) => ({ ok: true, result });
  server.responses.push(ok({ id: 123456, username: 'office_test_bot' }), ok({ url: '' }), ok({ id: -100123, type: 'supergroup' }), ok({ status: 'administrator' }), 'disconnect');
  const env = { PATH: process.env.PATH, TELEGRAM_BOT_TOKEN: '123456:dummy_dummy_dummy', TELEGRAM_CHAT_ID: '-100123', DATABASE_PATH: join(dir, 'state.db'), HEARTBEAT_PATH: heartbeat, TEST_API_ROOT: server.apiRoot };
  const child = fork(new URL('./harness/run-process.mjs', import.meta.url), { env, silent: true });
  let output = ''; child.stdout!.on('data', d => { output += String(d); }); child.stderr!.on('data', d => { output += String(d); });
  try {
    for (let i = 0; i < 500 && !existsSync(heartbeat); i++) await setTimeout(10);
    expect(existsSync(heartbeat)).toBe(true);
    expect(execFileSync(process.execPath, ['dist/cli.js', 'health'], { env, encoding: 'utf8' })).toContain('healthy');
    const exit = once(child, 'exit'); child.kill('SIGTERM'); expect((await exit)[0]).toBe(0);
    expect(output).toContain('iteration_failed'); expect(output).toContain('stopped'); expect(output).not.toContain('dummy_dummy_dummy');
    writeFileSync(heartbeat, JSON.stringify({ at: 0, pid: process.pid }));
    expect(() => execFileSync(process.execPath, ['dist/cli.js', 'health'], { env, stdio: 'pipe' })).toThrow();
  } finally {
    if (child.exitCode === null && child.signalCode === null) { const exit = once(child, 'exit'); child.kill('SIGKILL'); await exit; }
    await server.close(); rmSync(dir, { recursive: true });
  }
});
