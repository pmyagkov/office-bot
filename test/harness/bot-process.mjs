import { createRuntime } from '../../dist/runtime.js';
import { loadConfig } from '../../dist/config.js';
import { openStore } from '../../dist/store.js';
import { createTelegram } from '../../dist/telegram.js';
const config = loadConfig(process.env);
const store = openStore(config.database);
const telegram = createTelegram(config.token, { apiRoot: process.env.TEST_API_ROOT });
let now = new Date();
const runtime = createRuntime(config, store, telegram, () => now, 'office_test_bot');
process.on('message', async message => {
  now = new Date(message.now);
  try { await runtime.step(); process.send({ done: true }); }
  catch { process.send({ error: 'Step failed' }); }
});
process.on('SIGTERM', () => { store.close(); process.exit(0); });
process.send({ ready: true });
