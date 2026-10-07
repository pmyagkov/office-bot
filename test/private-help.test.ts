import { expect, it } from 'vitest';
import { at, harness } from './helpers/harness.js';

const now = at('09:30');
const last = (h: ReturnType<typeof harness>) => String(h.calls('sendMessage').at(-1)!.payload.text);

it('/start in the private chat lists every command available there and in the group', async () => {
  const h = harness();
  await h.updates.handleUpdate(h.event.command('/start', 11, 11), now);
  const text = last(h);
  for (const line of ['/flipper', '/schedule', '/cancel', '/help', '/today', '/stats month', '/history', '/test']) {
    expect(text).toContain(line);
  }
  expect(text).toContain("You're ready to receive a private reminder at 14:00");
  expect(h.store.get('user:11')).toMatchObject({ id: 11 });
});

it('the command list names /admin only for a group admin', async () => {
  const h = harness();
  h.mock.members.set(11, 'administrator'); h.mock.members.set(22, 'member');
  await h.updates.handleUpdate(h.event.command('/start', 22, 22), now);
  expect(last(h)).not.toContain('/admin');
  await h.updates.handleUpdate(h.event.command('/start', 11, 11), now);
  expect(last(h)).toContain('/admin');
});

it('/help in the private chat shows the same list', async () => {
  const h = harness();
  await h.updates.handleUpdate(h.event.command('/start', 11, 11), now);
  const start = last(h);
  await h.updates.handleUpdate(h.event.command('/help', 11, 11), now);
  expect(last(h)).toBe(start);
});
