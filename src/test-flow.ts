import type { InlineKeyboardMarkup, Update } from 'grammy/types';
import type { Services } from './scheduler.js';
import type { DayState, Operation, Participant } from './types.js';
import { scopedStore } from './store.js';
import { createDelivery } from './delivery.js';
import { createFlow } from './flow.js';
import { confirmAssignment } from './input-state.js';
import { assignmentMessage, mention, refreshAssignments } from './messages.js';
import { localTime } from './clock.js';
import { renderStats } from './reports.js';

export type TestSession = {
  id: string; day: string; owner: Participant; expiresAt: string;
  stage: 'ready' | 'opening' | 'voting' | 'closing' | 'result' | 'ending' | 'ended';
  panelId?: number; panelRender?: string; reminderRequested?: boolean; statsRequested?: boolean;
  assignmentCleaned?: boolean; cleanupPending?: boolean; panelAbandoned?: boolean;
};

export function createTestFlow(services: Services) {
  const { store, telegram, schedule, chatId } = services;
  const save = (s: TestSession) => store.set(`test-session:${s.id}`, s);
  const sessions = () => store.list<TestSession>('test-session:');
  const contexts = new Map<string, ReturnType<typeof makeContext>>();
  function makeContext(s: TestSession) {
    const scoped = scopedStore(store, `test:${s.id}:`);
    const delivery = createDelivery(scoped);
    const keyboard = (value?: InlineKeyboardMarkup): InlineKeyboardMarkup | undefined => value && ({ inline_keyboard: value.inline_keyboard.map(row => row.map(b => 'callback_data' in b && b.callback_data.startsWith('done:') ? { ...b, callback_data: `testdone:${s.id}:${b.callback_data.slice(5)}` } : b)) });
    const text = (value: string) => `[TEST] ${value.replaceAll('/today', '/test')}`;
    const port = { ...telegram,
      sendMessage: (to: number, value: string, buttons?: InlineKeyboardMarkup) => telegram.sendMessage(to, text(value), keyboard(buttons)),
      editMessage: (to: number, id: number, value: string, buttons?: InlineKeyboardMarkup) => telegram.editMessage(to, id, text(value), keyboard(buttons)),
    };
    return { store: scoped, delivery, telegram: port, flow: createFlow({ ...services, store: scoped, delivery, telegram: port }) };
  }
  function context(s: TestSession) {
    let c = contexts.get(s.id); if (!c) { c = makeContext(s); contexts.set(s.id, c); } return c;
  }
  const state = (s: TestSession) => context(s).store.get<DayState>(`day:${s.day}`);
  const expired = (s: TestSession, now: Date) => now.getTime() >= Date.parse(s.expiresAt);
  function active(now: Date) {
    return sessions().find(s => s.stage !== 'ended' && (!expired(s, now) || s.stage === 'ending'));
  }
  function start(update: Update, now: Date): string[] {
    const existing = active(now);
    if (existing) return [`[TEST] A test is already running, controlled by ${mention(existing.owner)}.${existing.panelId && String(chatId).startsWith('-100') ? `\n<a href="https://t.me/c/${String(chatId).slice(4)}/${existing.panelId}">Open test controls</a>` : '\nUse the existing test controls.'}`];
    const user = update.message?.from;
    if (!user || user.is_bot) return [];
    save({ id: update.update_id.toString(36), day: localTime(now, schedule.zone).day,
      owner: { id: user.id, name: [user.first_name, user.last_name].filter(Boolean).join(' ') },
      stage: 'ready', expiresAt: new Date(now.getTime() + 3_600_000).toISOString() });
    return [];
  }
  function restoreDeliveries() {
    for (const s of sessions()) {
      if (s.stage === 'ended') continue;
      const c = context(s); c.flow.restoreDeliveries();
      const op = c.store.get<Operation<number>>('op:panel');
      if (!s.panelId && op?.status === 'sent' && op.value) { s.panelId = op.value; save(s); }
    }
  }
  function apply(update: Update, now: Date): string | undefined {
    const cb = update.callback_query;
    if (!cb || !/^(test|testdone):/.test(cb.data ?? '')) return;
    const match = /^(test|testdone):([a-z0-9]+):(.+)$/.exec(cb.data ?? '');
    const s = match ? store.get<TestSession>(`test-session:${match[2]}`) : undefined;
    if (!s || ['ending', 'ended'].includes(s.stage) || expired(s, now)) return 'This test has ended. Send /test to start a new one.';
    if (match![1] === 'testdone') return confirmAssignment(context(s).store, { ...cb, data: `done:${match![3]}` }, now);
    if (cb.from.id !== s.owner.id || cb.message?.chat.id !== chatId || cb.message.message_id !== s.panelId) return 'Only the test starter can use these controls on the original panel.';
    const action = match![3]; const day = state(s);
    if (action === 'end') s.stage = 'ending';
    else if (action === 'open' && s.stage === 'ready') s.stage = 'opening';
    else if (action === 'close' && s.stage === 'voting') s.stage = 'closing';
    else if (action === 'remind' && s.stage === 'result' && day?.assignment?.messageId && !day.assignment.confirmedAt && !s.reminderRequested) s.reminderRequested = true;
    else if (action === 'stats' && day?.assignment?.confirmedAt && !s.statsRequested) s.statsRequested = true;
    else return 'This step is already complete or is not available yet.';
    save(s); return 'Test step requested.';
  }
  function panel(s: TestSession) {
    const c = context(s); const day = state(s); const a = day?.assignment;
    const rows: InlineKeyboardMarkup['inline_keyboard'] = [];
    const button = (text: string, action: string) => rows.push([{ text, callback_data: `test:${s.id}:${action}` }]);
    let status: string;
    switch (s.stage) {
      case 'ready': status = 'Ready. Open the two polls, then ask participants to vote. Use two different people: one requesting a check-in, one volunteering to help.'; button('Open test polls', 'open'); break;
      case 'opening': status = 'Opening test polls…'; break;
      case 'voting': status = 'Polls are open. After everyone votes, close them to draw a helper.'; button('Close polls & choose helper', 'close'); break;
      case 'closing': status = 'Closing polls and waiting for all identified votes…'; break;
      case 'result':
        status = a?.confirmedAt ? 'Check-ins confirmed. View the test statistics, then end the test.' : a ? `Selected helper: ${mention(a.helper)}. Send the test reminder before the helper confirms using “I\'ve checked everyone in” on the assignment message.` : day?.phase === 'empty' ? 'No check-ins needed. Start another test with a different requester and helper.' : 'Nobody volunteered. End this test and try again.';
        if (a?.messageId && !a.confirmedAt && !s.reminderRequested) button('Send test reminder', 'remind');
        if (a?.confirmedAt && !s.statsRequested) button('Show test stats', 'stats');
        break;
      case 'ending': status = 'Ending test and closing its controls…'; break;
      case 'ended': status = 'Test ended. Send /test for a new run.'; break;
    }
    const reminder = c.store.get<Operation>(`op:reminder:${s.day}`);
    if (reminder?.status === 'sent') status += '\nPrivate test reminder sent.';
    if (reminder?.status === 'rejected') {
      if (reminder.code === 429) status += '\nTelegram rate-limited the reminder. It will retry automatically after the requested delay.';
      else if (reminder.code === 409) status += '\nPrivate reminder cancelled because the test is no longer eligible.';
      else status += `\nPrivate reminder failed (${reminder.code}). The helper must open the bot privately and press /start; then try a new test.`;
    }
    const failures = c.store.list<Operation>('op:').filter(op => op.status === 'uncertain' || (op.status === 'rejected' && op.code !== 429 && !op.key.startsWith('reminder:')));
    if (failures.length) status += '\nA Telegram delivery failed or its result is unknown. It will not be resent blindly. End this test; any untracked poll expires automatically.';
    if (s.cleanupPending) status += '\nSome old messages could not be updated. This test is inactive; old buttons no longer work and its polls expire automatically.';
    if (!['ending', 'ended'].includes(s.stage)) button('End test', 'end');
    return { text: `<b>Test flow</b> — ${mention(s.owner)}\n\n${status}\n\nAll test records are separate from normal statistics. Only the starter controls the steps. The selected helper confirms. Private reminders require /start. This run expires after one hour.`, keyboard: { inline_keyboard: rows } };
  }
  async function render(s: TestSession, now: Date) {
    if (s.panelAbandoned) return;
    const c = context(s); const p = panel(s); const signature = JSON.stringify(p);
    if (!s.panelId) {
      const result = await c.delivery.deliver('panel', now, () => c.telegram.sendMessage(chatId, p.text, p.keyboard));
      if (result.kind !== 'sent') return;
      s.panelId = result.value; s.panelRender = signature; save(s);
    } else if (s.panelRender !== signature) {
      try { await c.telegram.editMessage(chatId, s.panelId, p.text, p.keyboard); s.panelRender = signature; save(s); }
      catch {
        // A deleted panel must not cause edit attempts forever.
        if (s.stage === 'ended' && expired(s, now)) { s.panelAbandoned = true; save(s); }
      }
    }
  }
  async function flush(now: Date, finalize = false) {
    restoreDeliveries();
    for (const s of sessions()) {
      const c = context(s);
      if (expired(s, now) && s.stage !== 'ended') { s.stage = 'ending'; save(s); }
      if (s.stage === 'opening') {
        if (Date.parse(s.expiresAt) - now.getTime() < 5_000) { s.stage = 'ending'; save(s); }
        else {
          await c.flow.openDay(s.day, new Date(s.expiresAt), now);
          if (state(s)?.signup?.messageId) { s.stage = 'voting'; save(s); }
        }
      }
      let day = state(s);
      if (s.stage === 'closing' && day) {
        if (day.phase === 'open') await c.flow.closeDay(day, now);
        day = state(s)!;
        if (['assigned', 'empty', 'no_helpers'].includes(day.phase)) { s.stage = 'result'; save(s); }
      }
      if (s.stage === 'result' && day) {
        await c.flow.publish(day, now);
        if (finalize && s.reminderRequested) await c.flow.remind(day, now, () => !expired(s, services.clock?.() ?? now));
        await refreshAssignments(c.store, c.telegram, schedule.zone);
        if (s.statsRequested) await c.delivery.deliver('stats', now, () => c.telegram.sendMessage(chatId, renderStats(c.store, s.day, 'week')));
      }
      if (s.stage === 'ending' || (s.stage === 'ended' && s.cleanupPending && !expired(s, now))) {
        const a = day?.assignment;
        if (a?.messageId && !s.assignmentCleaned) {
          try { await c.telegram.editMessage(chatId, a.messageId, `${assignmentMessage(a, schedule.zone)}\n\nTest ended.`); s.assignmentCleaned = true; }
          catch { /* The test is inactive even if Telegram cannot remove its old button. */ }
        }
        s.cleanupPending = !!(a?.messageId && !s.assignmentCleaned);
        s.stage = 'ended'; save(s);
      }
      await render(s, now);
    }
  }
  return { start, apply, restoreDeliveries, flush };
}
