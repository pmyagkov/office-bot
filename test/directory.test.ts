import { expect, it } from 'vitest';
import { findByUsername, rememberUsername } from '../src/directory.js';
import { openStore } from '../src/store.js';
import { at } from './helpers/harness.js';

const now = at('09:30');

it('the newest holder of a username wins, and a rename does not wipe them', () => {
  const store = openStore(':memory:');
  rememberUsername(store, 22, 'alice', now);
  rememberUsername(store, 33, 'alice', now);
  expect(findByUsername(store, '@alice')).toBe(33);
  rememberUsername(store, 22, 'bob', now);
  expect(findByUsername(store, '@alice')).toBe(33);
  expect(findByUsername(store, 'BOB')).toBe(22);
});
