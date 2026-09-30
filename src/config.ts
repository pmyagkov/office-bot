import type { Schedule } from './types.js';
export type Config = { token: string; chatId: number; database: string; heartbeat: string; schedule: Schedule };
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const token = env.TELEGRAM_BOT_TOKEN ?? '';
  if (!/^\d+:[A-Za-z0-9_-]{10,}$/.test(token)) throw new Error('TELEGRAM_BOT_TOKEN is invalid');
  const chatId = Number(env.TELEGRAM_CHAT_ID);
  if (!Number.isSafeInteger(chatId) || chatId >= 0) throw new Error('TELEGRAM_CHAT_ID must be a negative safe integer');
  const zone = env.TZ || 'Europe/Belgrade';
  try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(); }
  catch { throw new Error('TZ is invalid'); }
  return { token, chatId, database: env.DATABASE_PATH || 'data/office.db',
    heartbeat: env.HEARTBEAT_PATH || 'data/heartbeat.json',
    schedule: { zone, openMinute: 540, closeMinute: 600, reminderMinute: 840 } };
}
