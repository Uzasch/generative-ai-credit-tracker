import { describe, expect, it } from 'vitest';
import { badgeText, nextBadgeExpiry, pruneCaptures } from './badge';

const WINDOW = 120_000;

describe('pruneCaptures', () => {
  it('keeps only captures still inside the rolling window', () => {
    const times = [1000, 2000, 3000];
    // Window ends at 2000 + WINDOW, so the 1000 capture (just) survives here.
    expect(pruneCaptures(times, 1000 + WINDOW, WINDOW)).toEqual([2000, 3000]);
  });

  it('drops everything once the window has fully elapsed', () => {
    expect(pruneCaptures([1000, 2000], 2000 + WINDOW + 1, WINDOW)).toEqual([]);
  });

  it('returns a new array — it never mutates the input', () => {
    const times = [1000, 2000];
    const pruned = pruneCaptures(times, 1000 + WINDOW + 1, WINDOW);
    expect(pruned).toEqual([2000]);
    expect(times).toEqual([1000, 2000]);
  });
});

describe('badgeText', () => {
  it('renders the count within the window', () => {
    expect(badgeText(1)).toBe('1');
    expect(badgeText(3)).toBe('3');
  });

  it('caps the displayed count at 9+', () => {
    expect(badgeText(10)).toBe('9+');
    expect(badgeText(42)).toBe('9+');
  });

  it('an empty window renders the clear sentinel (empty string)', () => {
    expect(badgeText(0)).toBe('');
  });
});

describe('nextBadgeExpiry', () => {
  it('is the oldest capture plus the window — not the newest', () => {
    // Captures at 0s and 119s: the first ages out at 120s, so decay is scheduled
    // then (a "clear after the newest" timer would leave the first counted).
    expect(nextBadgeExpiry([0, 119_000], WINDOW)).toBe(WINDOW);
  });

  it('is null when there are no captures', () => {
    expect(nextBadgeExpiry([], WINDOW)).toBeNull();
  });
});
