import { run } from '../../dist/main.js';
import { createTelegram } from '../../dist/telegram.js';
import { loadConfig } from '../../dist/config.js';
const config = loadConfig(process.env);
await run(config, createTelegram(config.token, { apiRoot: process.env.TEST_API_ROOT }), () => new Date('2026-09-30T20:00:00Z'));
