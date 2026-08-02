import { describe, expect, it } from 'vitest';
import { ClickRequestCorrelator, matchesGenerateLabel, toolFromHost } from './tripwire';

const WINDOW = 4000;
const HOST = 'higgsfield.ai';

describe('ClickRequestCorrelator', () => {
  it('a request within the window explains the click — nothing is flagged', () => {
    const c = new ClickRequestCorrelator(WINDOW);
    c.onClick({ host: HOST, clickedAt: 1000 });
    // Request lands 2s after the click, inside the window.
    expect(c.onGenerateRequest(3000)).toBe(true);
    expect(c.sweepExpired(1000 + WINDOW + 1)).toEqual([]);
    expect(c.pendingCount).toBe(0);
  });

  it('a click with no request is flagged once its window elapses', () => {
    const c = new ClickRequestCorrelator(WINDOW);
    const click = { host: HOST, clickedAt: 1000 };
    c.onClick(click);
    // Still inside the window — not yet flagged.
    expect(c.sweepExpired(1000 + WINDOW)).toEqual([]);
    // Past the window — flagged, and removed so it can't be flagged twice.
    expect(c.sweepExpired(1000 + WINDOW + 1)).toEqual([click]);
    expect(c.sweepExpired(9_999_999)).toEqual([]);
  });

  it('a request that arrives after the window does NOT explain the click', () => {
    const c = new ClickRequestCorrelator(WINDOW);
    c.onClick({ host: HOST, clickedAt: 1000 });
    // Too late — this request belongs to no pending click.
    expect(c.onGenerateRequest(1000 + WINDOW + 500)).toBe(false);
    expect(c.pendingCount).toBe(1);
  });

  it('tolerates a request whose clock lands slightly before the click', () => {
    const c = new ClickRequestCorrelator(WINDOW, 1000);
    c.onClick({ host: HOST, clickedAt: 5000 });
    // Request captured 800ms "before" the click due to clock skew — still matched.
    expect(c.onGenerateRequest(4200)).toBe(true);
    expect(c.pendingCount).toBe(0);
  });

  it('one request consumes the oldest click; the other still gets flagged', () => {
    const c = new ClickRequestCorrelator(WINDOW);
    const first = { host: HOST, clickedAt: 1000 };
    const second = { host: HOST, clickedAt: 1500 };
    c.onClick(first);
    c.onClick(second);
    // A single generate request explains only the oldest pending click.
    expect(c.onGenerateRequest(2000)).toBe(true);
    const flagged = c.sweepExpired(1500 + WINDOW + 1);
    expect(flagged).toEqual([second]);
  });

  it('a request with no pending click is a harmless no-op', () => {
    const c = new ClickRequestCorrelator(WINDOW);
    expect(c.onGenerateRequest(1234)).toBe(false);
  });

  it('matches a request whose message arrives before its click (reordered delivery)', () => {
    const c = new ClickRequestCorrelator(WINDOW);
    // The request-start signal reaches the background first, before the click
    // message. Its true timestamp is still AFTER the click (a click fires the
    // request), so it must be buffered, not discarded.
    expect(c.onGenerateRequest(1200, 7)).toBe(false);
    // The click (fired at 1000, delivered late) then consumes the buffered request
    // and is NOT left pending — so it won't be swept as a false anomaly.
    c.onClick({ host: HOST, clickedAt: 1000, tabId: 7 });
    expect(c.pendingCount).toBe(0);
    expect(c.sweepExpired(1000 + WINDOW + 1)).toEqual([]);
  });

  it('a buffered request only matches a click from the same tab', () => {
    const c = new ClickRequestCorrelator(WINDOW);
    c.onGenerateRequest(1200, 1);
    // A click in a different tab must not consume tab 1's buffered request.
    const other = { host: HOST, clickedAt: 1000, tabId: 2 };
    c.onClick(other);
    expect(c.sweepExpired(1000 + WINDOW + 1)).toEqual([other]);
  });

  it("a request in one tab does not consume another tab's click", () => {
    const c = new ClickRequestCorrelator(WINDOW);
    const tab1Click = { host: HOST, clickedAt: 1000, tabId: 1 };
    c.onClick(tab1Click);
    // A generate request in a DIFFERENT tab must not explain tab 1's click.
    expect(c.onGenerateRequest(1500, 2)).toBe(false);
    expect(c.pendingCount).toBe(1);
    // The real request in tab 1 does match it.
    expect(c.onGenerateRequest(1600, 1)).toBe(true);
    expect(c.pendingCount).toBe(0);
  });
});

describe('toolFromHost', () => {
  it('maps each tracked tool host to its Tool', () => {
    expect(toolFromHost('higgsfield.ai')).toBe('higgsfield');
    expect(toolFromHost('app.klingai.com')).toBe('kling');
    expect(toolFromHost('labs.google')).toBe('flow');
  });

  it('returns null for an untracked host', () => {
    expect(toolFromHost('example.com')).toBeNull();
  });
});

describe('matchesGenerateLabel', () => {
  it('matches Generate button labels', () => {
    expect(matchesGenerateLabel('Generate')).toBe(true);
    expect(matchesGenerateLabel('Generate video')).toBe(true);
    expect(matchesGenerateLabel('Generate (100)')).toBe(true);
  });

  it('does not match Regenerate or unrelated labels', () => {
    expect(matchesGenerateLabel('Regenerate')).toBe(false);
    expect(matchesGenerateLabel('Download')).toBe(false);
    expect(matchesGenerateLabel('')).toBe(false);
  });
});
