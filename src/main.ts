import { pathToFileURL } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { loadConfig, type Config } from './config.js';
import { openStore } from './store.js';
import { createTelegram, type TelegramPort } from './telegram.js';
import { createRuntime } from './runtime.js';

export async function run(config: Config, telegram: TelegramPort = createTelegram(config.token), clock = () => new Date()): Promise<void> {
  const identity = await telegram.api.getMe();
  const webhook = await telegram.api.getWebhookInfo();
  if (webhook.url) throw Error('A webhook is configured; remove it before starting polling');
  const chat = await telegram.api.getChat(config.chatId);
  if (chat.type !== 'group' && chat.type !== 'supergroup') throw Error('Configured chat must be a group');
  const membership = await telegram.api.getChatMember(config.chatId, identity.id);
  if (!['administrator', 'creator', 'member'].includes(membership.status)) throw Error('Bot cannot participate in the configured group');
  const store = openStore(config.database);
  const runtime = createRuntime(config, store, telegram, clock, identity.username);
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  console.info(JSON.stringify({ event: 'started', bot: identity.username, chatId: config.chatId }));
  try {
    while (!stopping) {
      try { await runtime.step(10); }
      catch { console.error(JSON.stringify({ event: 'iteration_failed', message: 'Telegram or database unavailable; retrying without advancing unprocessed updates' })); await pause(2000); }
      if (!stopping) await pause(250);
    }
  } finally {
    store.close(); process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
    console.info(JSON.stringify({ event: 'stopped' }));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(loadConfig(process.env)).catch(() => { console.error('Office bot startup failed. Check configuration, permissions and connectivity.'); process.exitCode = 1; });
}
