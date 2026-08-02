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

  it('seeds the window from the successful-record time, not a stale capture time (#18 review)', () => {
    // The badge window must be measured from when the event actually recorded, not
    // from `capture.capturedAt` — a page-shared, possibly stale-or-spoofed client
    // timestamp. Simulate a delayed/offline write whose capture time is already
    // older than the whole window by the time it records.
    const recordedAt = 1_000_000;
    const staleCapturedAt = recordedAt - WINDOW - 1;
    // Seeding off the stale capture time: it is already outside the window, so the
    // badge would prune to empty the instant it painted (paint-then-clear bug).
    expect(pruneCaptures([staleCapturedAt], recordedAt, WINDOW)).toEqual([]);
    // Seeding off the record time keeps this just-recorded generation counted.
    expect(pruneCaptures([recordedAt], recordedAt, WINDOW)).toEqual([recordedAt]);
  });

  it('a future capture timestamp no longer keeps the badge lit past the window (#18 review)', () => {
    // A spoofed/future `capturedAt` seeded into the window would linger well beyond
    // two minutes; the record time is always "now", so its decay is honest.
    const recordedAt = 1_000_000;
    const futureCapturedAt = recordedAt + 10 * WINDOW;
    // If the future capture time were stored, it would still be "inside" the window
    // long after the activity really happened.
    expect(pruneCaptures([futureCapturedAt], recordedAt + WINDOW + 1, WINDOW)).toEqual([
      futureCapturedAt,
    ]);
    // Seeded from the record time it ages out exactly one window later, as intended.
    expect(pruneCaptures([recordedAt], recordedAt + WINDOW + 1, WINDOW)).toEqual([]);
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
