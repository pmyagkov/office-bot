import { readFileSync } from 'node:fs';
import { openStore } from './store.js';
import { createTelegram } from './telegram.js';
import { recoverOperation } from './operations.js';
import type { Operation } from './types.js';

async function main() {
  const [command, action, key, ...flags] = process.argv.slice(2);
  if (command === 'health') {
    const heartbeat = JSON.parse(readFileSync(process.env.HEARTBEAT_PATH || 'data/heartbeat.json', 'utf8')) as { at: number; pid: number };
    if (!Number.isFinite(heartbeat.at) || Date.now() - heartbeat.at > 120_000 || heartbeat.at > Date.now() + 5000) throw Error('Heartbeat is stale');
    process.kill(heartbeat.pid, 0); console.info('healthy'); return;
  }
  if (command === 'discover') {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw Error('TELEGRAM_BOT_TOKEN is required');
    const telegram = createTelegram(token); const me = await telegram.api.getMe();
    let offset = 0;
    console.info(`Send /setup@${me.username} in the intended group. Stop other polling processes first.`);
    while (true) {
      for (const update of await telegram.getUpdates(offset, 10)) {
        offset = update.update_id + 1; const m = update.message;
        if (m && (m.chat.type === 'group' || m.chat.type === 'supergroup') && m.text?.trim() === `/setup@${me.username}`) {
          console.info(JSON.stringify({ chatId: m.chat.id, title: m.chat.title })); return;
        }
      }
    }
  }
  const store = openStore(process.env.DATABASE_PATH || 'data/office.db');
  try {
    if (command === 'backup' && action) { await store.backup(action); console.info('Backup complete'); }
    else if (command === 'operations' && action === 'list') console.info(JSON.stringify(store.list<Operation>('op:').filter(op => op.status !== 'sent'), null, 2));
    else if (command === 'operations' && (action === 'retry' || action === 'resolve') && key) {
      if (!flags.includes('--verified-in-telegram')) throw Error('Stop the bot, check the actual Telegram messages, then pass --verified-in-telegram');
      const value = (name: string) => { const index = flags.indexOf(name); return index >= 0 ? flags[index + 1] : undefined; };
      recoverOperation(store, key, action, Number(value('--message-id')), value('--poll-id'));
      console.info('Recovery saved. Restart the bot; the existing assignment is preserved.');
    } else throw Error('Usage: health | discover | backup <path> | operations list | operations retry|resolve <key> --verified-in-telegram [--message-id N] [--poll-id ID]');
  } finally { store.close(); }
}
main().catch(error => {
  // Never include Telegram/network exceptions: their URLs contain the bot token.
  const message = error instanceof Error && !/https?:|bot\d+:/.test(error.message) ? error.message : 'Operation failed; check configuration and connectivity';
  console.error(message); process.exitCode = 1;
});
