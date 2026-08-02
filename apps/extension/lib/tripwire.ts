import type { Tool } from '@token-tracker/shared';

/**
 * Click tripwire correlation (#8, ADR-0002). The ISOLATED-world tripwire content
 * script observes Generate-button clicks; the background correlates each click
 * against captured generate requests. A click with **no** matching generate
 * request within the window is a `click-no-request` anomaly (the canonical
 * "cancel a generation after clicking Generate" case, CONTEXT.md) — recorded as
 * raw evidence rather than guessed.
 *
 * This module is the pure correlation core (no DOM, no timers, no I/O) so it is
 * unit-testable; the background drives it with real messages and a sweep timer,
 * and the content script supplies the clicks.
 */

/** A Generate click the tripwire observed, awaiting a matching generate request. */
export type PendingClick = {
  /** Page host the click happened on (maps to a Tool via {@link toolFromHost}). */
  host: string;
  /** When the click fired, client ms epoch. */
  clickedAt: number;
  /**
   * Browser tab the click came from (the runtime message sender's tab id).
   * Correlation is scoped to it so a generate request in one tab can never
   * consume — and thereby suppress the anomaly of — a click in another tab.
   * `undefined` when the sender exposed no tab (defensive; both sides then share
   * the `undefined` scope).
   */
  tabId?: number;
  /**
   * The editor's Active Organization at the moment the click was observed,
   * captured here so a mid-window Org switch can't misattribute the anomaly to a
   * different tenant when it is finally swept (ADR-0004). `undefined` when no
   * Active context existed at click time — such a click can't be attributed and
   * is dropped at sweep, never invented into an Org.
   */
  organizationId?: string;
};

/** A generate request observed with no matching click yet — retained briefly. */
type PendingRequest = { at: number; tabId?: number };

/**
 * Pairs observed Generate clicks with observed generate requests. A click is
 * "explained" once a generate request lands within its window; a click whose
 * window elapses unexplained is swept out as a `click-no-request` anomaly.
 *
 * Correlation is order-independent: clicks and generate-request signals travel
 * through different content scripts and message paths, so either can reach the
 * background first. Each side buffers briefly and consumes a plausible partner
 * from the other's buffer, matching on the true event *timestamps* (which do
 * preserve order — a click precedes the request it fires) rather than on message
 * arrival order. So a request whose message merely arrives before its click's is
 * still matched, not discarded (which would have false-flagged a real generation).
 */
export class ClickRequestCorrelator {
  private readonly pending: PendingClick[] = [];
  private readonly pendingRequests: PendingRequest[] = [];

  constructor(
    /** How long after a click we wait for its generate request before flagging. */
    private readonly windowMs: number,
    /**
     * Clock-skew tolerance: the click time (page clock, in the content script)
     * and the request start time (the fetch-patch clock) are independent, so a
     * real request can land a hair *before* its click. Without this slop that
     * skew would flag a genuine request as missing.
     */
    private readonly slopMs = 1000,
  ) {}

  /**
   * Record an observed Generate click. If a generate request from the same tab
   * has already been seen that plausibly belongs to it (its message merely
   * arrived first), consume that request and do NOT flag the click.
   */
  onClick(click: PendingClick): void {
    const i = this.pendingRequests.findIndex(
      (req) => req.tabId === click.tabId && this.within(click.clickedAt, req.at),
    );
    if (i !== -1) {
      this.pendingRequests.splice(i, 1);
      return;
    }
    this.pending.push(click);
  }

  /**
   * A generate request was observed at `at` in tab `tabId`. Consume the OLDEST
   * still-pending click FROM THE SAME TAB that it plausibly belongs to — one that
   * fired no more than `windowMs` before the request (and no more than `slopMs`
   * after it, for clock skew). Returns true when a click was matched, so that
   * click will not be flagged. When no click is pending yet (the request's message
   * won the race), the request is retained so a slightly-later click can consume
   * it. Tab scoping stops a request in one tab from suppressing another tab's click.
   */
  onGenerateRequest(at: number, tabId?: number): boolean {
    for (let i = 0; i < this.pending.length; i++) {
      const click = this.pending[i];
      if (click === undefined) continue;
      if (click.tabId !== tabId) continue;
      if (this.within(click.clickedAt, at)) {
        this.pending.splice(i, 1);
        return true;
      }
    }
    // No pending click yet — retain the request so a click arriving next can match it.
    this.pendingRequests.push({ at, tabId });
    return false;
  }

  /**
   * Remove and return the clicks whose window has fully elapsed by `now` with no
   * matching generate request — each is a `click-no-request` anomaly. Clicks still
   * inside their window are retained (a request may yet explain them). Stale
   * buffered requests (past the window) are pruned here too — an unmatched request
   * is just an ordinary generation, never an anomaly.
   */
  sweepExpired(now: number): PendingClick[] {
    const expired: PendingClick[] = [];
    const kept: PendingClick[] = [];
    for (const click of this.pending) {
      if (now - click.clickedAt > this.windowMs) expired.push(click);
      else kept.push(click);
    }
    this.pending.length = 0;
    this.pending.push(...kept);

    const keptRequests = this.pendingRequests.filter((req) => now - req.at <= this.windowMs);
    this.pendingRequests.length = 0;
    this.pendingRequests.push(...keptRequests);

    return expired;
  }

  /** How many clicks are still awaiting a generate request (for tests/inspection). */
  get pendingCount(): number {
    return this.pending.length;
  }

  /**
   * Whether a click at `clickedAt` and a request at `requestAt` belong together:
   * the request fired no more than `windowMs` after the click, and no more than
   * `slopMs` before it (clock skew). Symmetric across both entry points.
   */
  private within(clickedAt: number, requestAt: number): boolean {
    const delta = requestAt - clickedAt; // > 0: request after click (the normal order)
    return delta <= this.windowMs && delta >= -this.slopMs;
  }
}

/**
 * Map a page host to the Tool it belongs to, or `null` if none of the tracked
 * tools own it. The tripwire only runs on the three tool hosts (TOOL_MATCHES), so
 * `null` should not occur in practice — it's the defensive boundary.
 */
export function toolFromHost(host: string): Tool | null {
  if (host.includes('higgsfield.ai')) return 'higgsfield';
  if (host.includes('klingai.com')) return 'kling';
  if (host.includes('labs.google')) return 'flow';
  return null;
}

/**
 * Whether a button's accessible label denotes a Generate action. Matches
 * "Generate", "Generate video", "Generate (100)"; the `\b…\b` boundaries exclude
 * "Regenerate" so a re-run of an existing generation isn't treated as a fresh one.
 */
const GENERATE_LABEL = /\bgenerate\b/i;
export function matchesGenerateLabel(label: string): boolean {
  return GENERATE_LABEL.test(label);
}
