import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { openStore, type Store } from '../src/store.js';
import { getFlipperName, setFlipperName, validateFlipperName } from '../src/flipper.js';

describe('validateFlipperName', () => {
  it('trims and accepts valid names', () => {
    expect(validateFlipperName('  Pavel  ')).toBe('Pavel');
    expect(validateFlipperName('Анна <&> 🙂')).toBe('Анна <&> 🙂');
    expect(validateFlipperName('a'.repeat(64))).toBe('a'.repeat(64));
    expect(validateFlipperName('🙂'.repeat(64))).toBe('🙂'.repeat(64));
  });
  it('rejects empty, whitespace-only, too long and control characters', () => {
    expect(validateFlipperName('')).toBeNull();
    expect(validateFlipperName('   \t ')).toBeNull();
    expect(validateFlipperName('a'.repeat(65))).toBeNull();
    expect(validateFlipperName('🙂'.repeat(65))).toBeNull();
    expect(validateFlipperName('two\nlines')).toBeNull();
    expect(validateFlipperName('bell\u0007')).toBeNull();
  });
});

describe('Flipper name registry', () => {
  let store: Store;
  beforeEach(() => { store = openStore(':memory:'); });
  afterEach(() => { store.close(); });

  it('round-trips a stored name', () => {
    setFlipperName(store, 11, 'Анна', 99, new Date('2026-10-01T09:00:00Z'));
    expect(getFlipperName(store, 11)).toBe('Анна');
    expect(store.get('flipper:11')).toEqual({ name: 'Анна', setBy: 99, at: '2026-10-01T09:00:00.000Z' });
  });
  it('overwrites on a second set', () => {
    setFlipperName(store, 11, 'Анна', 99, new Date('2026-10-01T09:00:00Z'));
    setFlipperName(store, 11, 'Аня', 11, new Date('2026-10-02T09:00:00Z'));
    expect(getFlipperName(store, 11)).toBe('Аня');
  });
  it('returns undefined for an unknown id', () => {
    expect(getFlipperName(store, 404)).toBeUndefined();
  });
});
