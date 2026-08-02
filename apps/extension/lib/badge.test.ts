import { describe, expect, it } from 'vitest';
import { RecentActivityBadge } from './badge';

const WINDOW = 60_000;

describe('RecentActivityBadge', () => {
  it('shows the count of captures within the rolling window', () => {
    const badge = new RecentActivityBadge(WINDOW);
    expect(badge.record(1000)).toBe('1');
    expect(badge.record(2000)).toBe('2');
    expect(badge.record(3000)).toBe('3');
  });

  it('decays: captures older than the window drop out of the count', () => {
    const badge = new RecentActivityBadge(WINDOW);
    badge.record(1000);
    badge.record(2000);
    // A capture arriving just past the first one's window expiry evicts it.
    expect(badge.record(1000 + WINDOW + 1)).toBe('2'); // 2000 + the new one
    // Read far in the future — the window is empty, so no badge.
    expect(badge.text(1000 + 10 * WINDOW)).toBe('');
  });

  it('text() reports the decayed count without recording a capture', () => {
    const badge = new RecentActivityBadge(WINDOW);
    badge.record(1000);
    expect(badge.text(1000 + WINDOW / 2)).toBe('1');
    expect(badge.text(1000 + WINDOW + 1)).toBe('');
  });

  it('caps the displayed count at 9+', () => {
    const badge = new RecentActivityBadge(WINDOW);
    let text = '';
    for (let i = 0; i < 12; i++) {
      text = badge.record(1000 + i);
    }
    expect(text).toBe('9+');
  });

  it('an empty badge renders the clear sentinel (empty string)', () => {
    const badge = new RecentActivityBadge(WINDOW);
    expect(badge.text(1000)).toBe('');
  });
});
