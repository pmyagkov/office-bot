import { expect, it } from 'vitest';
import { openStore } from '../src/store.js';
import { recoverOperation } from '../src/operations.js';
it('requires an existing unresolved operation and a valid message identity', () => {
  const store = openStore(':memory:');
  try {
    expect(() => recoverOperation(store, 'missing', 'retry')).toThrow();
    store.set('op:signup:2026-09-30', { key: 'signup:2026-09-30', status: 'uncertain' });
    expect(() => recoverOperation(store, 'signup:2026-09-30', 'resolve')).toThrow();
    expect(() => recoverOperation(store, 'signup:2026-09-30', 'resolve', 0)).toThrow();
    recoverOperation(store, 'signup:2026-09-30', 'resolve', 10);
    expect(store.get('op:signup:2026-09-30')).toMatchObject({ status: 'sent', value: 10 });
    expect(() => recoverOperation(store, 'signup:2026-09-30', 'retry')).toThrow();
    store.set('op:poll:2026-09-30:helper', { key: 'poll:2026-09-30:helper', status: 'uncertain' });
    recoverOperation(store, 'poll:2026-09-30:helper', 'resolve', 11);
    expect(store.get('op:poll:2026-09-30:helper')).toMatchObject({ status: 'sent', value: 11 });
  } finally { store.close(); }
});
it('reopens a command job for a deliberate retry without touching a frozen assignment', () => {
  const store = openStore(':memory:');
  try {
    store.set('op:command:30:0', { key: 'command:30:0', status: 'uncertain' }); store.set('reply:command:30', { key: 'command:30', done: true });
    store.set('day:2026-09-30', { assignment: { helper: 11, recipients: [22] } });
    recoverOperation(store, 'command:30:0', 'retry'); expect(store.get('op:command:30:0')).toMatchObject({ status: 'prepared' });
    expect(store.get('reply:command:30')).toMatchObject({ done: false }); expect(store.get('day:2026-09-30')).toEqual({ assignment: { helper: 11, recipients: [22] } });
  } finally { store.close(); }
});
