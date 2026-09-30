import { expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
const valid = { TELEGRAM_BOT_TOKEN: '123456:dummy_dummy_dummy', TELEGRAM_CHAT_ID: '-1001234567890' };
it('validates configuration without exposing secrets', () => {
  expect(loadConfig(valid)).toMatchObject({ chatId: -1001234567890, schedule: { zone: 'Europe/Belgrade', openMinute: 540, closeMinute: 600, reminderMinute: 840 } });
  for (const env of [{}, { ...valid, TELEGRAM_CHAT_ID: '123' }, { ...valid, TELEGRAM_CHAT_ID: '-9007199254740992' }, { ...valid, TZ: 'invalid/zone' }]) {
    expect(() => loadConfig(env)).toThrow();
  }
  try { loadConfig({ ...valid, TELEGRAM_BOT_TOKEN: 'secret' }); } catch (e) { expect(String(e)).not.toContain('secret'); }
});
