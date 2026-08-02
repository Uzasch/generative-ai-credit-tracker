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
};

/**
 * Pairs observed Generate clicks with observed generate requests. A click is
 * "explained" once a generate request lands within its window; a click whose
 * window elapses unexplained is swept out as a `click-no-request` anomaly.
 */
export class ClickRequestCorrelator {
  private readonly pending: PendingClick[] = [];

  constructor(
    /** How long after a click we wait for its generate request before flagging. */
    private readonly windowMs: number,
    /**
     * Clock-skew tolerance: the click time (page clock, in the content script)
     * and the request capture time (the fetch-patch clock) are independent, so a
     * real request can land a hair *before* its click. Without this slop that
     * skew would flag a genuine request as missing.
     */
    private readonly slopMs = 1000,
  ) {}

  /** Record an observed Generate click. */
  onClick(click: PendingClick): void {
    this.pending.push(click);
  }

  /**
   * A generate request was captured at `at`. Consume the OLDEST still-pending
   * click it plausibly belongs to — one that fired no more than `windowMs` before
   * the request (and no more than `slopMs` after it, for clock skew). Returns
   * true when a click was matched, so that click will not be flagged.
   */
  onGenerateRequest(at: number): boolean {
    for (let i = 0; i < this.pending.length; i++) {
      const click = this.pending[i];
      if (click === undefined) continue;
      const delta = at - click.clickedAt; // > 0: request after click (the normal order)
      if (delta <= this.windowMs && delta >= -this.slopMs) {
        this.pending.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  /**
   * Remove and return the clicks whose window has fully elapsed by `now` with no
   * matching generate request — each is a `click-no-request` anomaly. Clicks
   * still inside their window are retained (a request may yet explain them).
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
    return expired;
  }

  /** How many clicks are still awaiting a generate request (for tests/inspection). */
  get pendingCount(): number {
    return this.pending.length;
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
