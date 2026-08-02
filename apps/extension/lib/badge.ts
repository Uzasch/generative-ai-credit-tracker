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
 * `browser.action` / storage / alarms glue): free functions over an array of
 * capture times, no clock and no I/O of their own. The background persists that
 * array and drives the decay with a durable alarm, because an MV3 service worker
 * can be terminated between captures (an in-memory count or a `setTimeout` would
 * be lost, leaving the badge stuck lit — the pure state lives in storage instead).
 */

/** Above this the badge shows `9+` — a two-glyph badge is all the toolbar fits. */
export const MAX_SHOWN = 9;

/**
 * The capture times still inside the rolling window ending at `now`. Total and
 * pure: filtering keeps callers from mutating persisted state in place.
 */
export function pruneCaptures(times: readonly number[], now: number, windowMs: number): number[] {
  const cutoff = now - windowMs;
  return times.filter((t) => t > cutoff);
}

/**
 * The badge text for a capture count. Empty string means "no badge" — the caller
 * clears the toolbar badge on that, so an emptied window shows nothing.
 */
export function badgeText(count: number): string {
  if (count <= 0) return '';
  return count > MAX_SHOWN ? `${MAX_SHOWN}+` : String(count);
}

/**
 * When the oldest retained capture leaves the window (ms epoch), or `null` when no
 * capture remains. The caller schedules its decay alarm for this instant, so the
 * badge recomputes exactly when a capture ages out — then reschedules for the next
 * oldest, until the window is empty (a single "clear after the newest" timer would
 * leave an already-expired earlier capture in the count).
 */
export function nextBadgeExpiry(times: readonly number[], windowMs: number): number | null {
  if (times.length === 0) return null;
  let oldest = times[0] as number;
  for (const t of times) if (t < oldest) oldest = t;
  return oldest + windowMs;
}
