import { afterEach, expect, it } from 'vitest';
import { harness, at } from './helpers/harness.js';
import type { DayState } from '../src/types.js';
import { renderHistory, renderStats } from '../src/reports.js';
const instances: ReturnType<typeof harness>[] = [];
afterEach(() => instances.splice(0).forEach(h => h.store.close()));
async function setup() { const h = harness(); instances.push(h); await h.scheduler.tick(at('09:00')); h.vote('helper', 11); for (const id of [22, 33, 44]) h.vote('request', id); await h.close(); return h; }
it('counts a duty separately from three completed check-ins through /stats', async () => {
  const h = await setup(); await h.updates.handleUpdate(h.event.command('/stats'), at('11:00')); expect(h.calls('sendMessage').at(-1)?.payload.text).toContain('No confirmed');
  await h.updates.handleUpdate(h.event.click('2026-09-30', 11, 3), at('11:01')); await h.updates.handleUpdate(h.event.command('/stats@office_test_bot'), at('11:02'));
  expect(h.calls('sendMessage').at(-1)?.payload.text).toContain('1 duties · 3 check-ins performed · 0 received');
  expect(h.calls('sendMessage').at(-1)?.payload.text).toContain('0 duties · 0 check-ins performed · 1 received');
});
it('filters by assignment date but displays the actual confirmation time', async () => {
  const h = await setup(); await h.updates.handleUpdate(h.event.click('2026-09-30', 11, 3), at('11:01', '2026-10-01'));
  expect(renderStats(h.store, '2026-10-01', 'month')).toContain('No confirmed'); expect(renderStats(h.store, '2026-10-01', 'week')).toContain('1 duties');
  expect(renderHistory(h.store, 10, 'Europe/Belgrade')).toContain('01 Oct 2026, 11:01');
});
it('keeps long history within Telegram limits with escaped names', async () => {
  const h = await setup(); const day = h.day(); day.assignment!.confirmedAt = at('11:00').toISOString(); day.assignment!.helper.name = '<'.repeat(100);
  for (let i = 1; i <= 25; i++) { const copy: DayState = structuredClone(day); copy.day = `2026-09-${String(i).padStart(2, '0')}`; copy.assignment!.day = copy.day; h.store.set(`day:${copy.day}`, copy); }
  const report = renderHistory(h.store, 100, 'Europe/Belgrade'); expect(report.length).toBeLessThan(4000); expect(report).toContain('&lt;');
});
it('ignores commands in other groups/private chats and addressed to other bots', async () => {
  const h = await setup(); const before = h.calls('sendMessage').length;
  for (const update of [h.event.command('/stats', -999), h.event.command('/stats', 11), h.event.command('/stats@other_bot')]) await h.updates.handleUpdate(update, at('11:00'));
  expect(h.calls('sendMessage')).toHaveLength(before);
  await h.updates.handleUpdate(h.event.command('/start', 11), at('11:01')); expect(h.calls('sendMessage').at(-1)?.payload.text).toContain('private reminder');
});
