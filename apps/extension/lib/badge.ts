/**
 * Toolbar badge activity model (issue #18). The background flips the browser
 * action badge the moment a generation is recorded, so an editor gets an
 * immediate "we got it" signal without opening the popup.
 *
 * The badge must reflect *recent* activity, not a stale lifetime count (issue #18
 * acceptance): a number that only ever grows would tell the editor nothing about
 * whether *this* generation was captured. So captures are counted within a rolling
 * time window and the count decays to empty once activity stops.
 *
 * This module is the pure counting core (AGENTS.md §9 — test the logic, not the
 * `browser.action` glue): it owns no timers and reads no clock, so the caller
 * supplies `now` and drives the reset. The background does the `browser.action`
 * I/O around it.
 */

/** Above this the badge shows `9+` — a two-glyph badge is all the toolbar fits. */
const MAX_SHOWN = 9;

/**
 * Counts generation captures within a rolling window and renders the badge text.
 * `record` is called when an event is recorded; `text` recomputes on demand (e.g.
 * from the caller's reset timer) so a window that has emptied clears the badge.
 */
export class RecentActivityBadge {
  private readonly windowMs: number;
  /** Capture times within the window, ascending; pruned on every read. */
  private captures: number[] = [];

  constructor(windowMs: number) {
    this.windowMs = windowMs;
  }

  /** Drop captures older than the rolling window ending at `now`. */
  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    // Times are appended in order, so the survivors are a suffix; find the first
    // one still inside the window and keep from there.
    const firstFresh = this.captures.findIndex((t) => t > cutoff);
    this.captures = firstFresh === -1 ? [] : this.captures.slice(firstFresh);
  }

  /**
   * Register a generation captured at `now` and return the badge text to show.
   * Empty string means "no badge" (never reached here — a fresh capture always
   * counts at least itself).
   */
  record(now: number): string {
    this.prune(now);
    this.captures.push(now);
    return this.render();
  }

  /**
   * The badge text for the window ending at `now`, after decay. Empty string when
   * no capture remains in the window — the caller clears the badge on that.
   */
  text(now: number): string {
    this.prune(now);
    return this.render();
  }

  private render(): string {
    const count = this.captures.length;
    if (count === 0) return '';
    return count > MAX_SHOWN ? `${MAX_SHOWN}+` : String(count);
  }
}
