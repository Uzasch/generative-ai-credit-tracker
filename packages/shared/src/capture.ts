/**
 * Capture-retention rules for the Phase-1 probe's `raw_captures` table.
 *
 * ADR-0001 captures `fnf-api-gw.higgsfield.ai` traffic broadly so unknown
 * signals (refunds, batch cost) stay discoverable. ADR-0007 narrows that "capture
 * all" to bound the table's growth without losing that discovery value: a
 * denylist drops known non-generation UI chatter, and identical consecutive
 * captures (the tool's own status polls) collapse to one row.
 *
 * Both rules are pure and deterministic so they can be unit-tested here and
 * enforced at a single write boundary (the Convex `rawCaptures.record` mutation).
 * Neither reads headers or bodies for anything but an exact-equality check, so no
 * new trust surface is introduced.
 */

/** Pathname of a URL, or null when it cannot be parsed. */
function pathnameOf(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

/**
 * Path prefixes we never retain (ADR-0007): high-volume UI chatter that the
 * tracker never reads. Matched as prefixes so both the collection endpoint and
 * its children are covered (e.g. `/fnf/folders` and `/fnf/folders/accessible`,
 * `/fnf/banner` and `/fnf/banners`). Generation traffic (`/fnf/jobs*`) and the
 * refund/wallet cross-check endpoints are deliberately absent, so they are kept.
 */
const DENYLISTED_PREFIXES = [
  '/fnf/folders',
  '/fnf/tours',
  '/fnf/banner',
  '/fnf/referral-campaigns',
  '/fnf/feedback',
  '/fnf/color-presets',
  '/fnf-notification/',
  // `/fnf/workspaces*` is noise except the wallet, carved out below for #17.
  '/fnf/workspaces',
] as const;

/**
 * Per-model preset lookups: `/fnf/{model}/presets/...`. The model segment
 * varies, so this can't be a fixed prefix. Kept separate from `/fnf/color-presets`
 * (which is a fixed prefix above).
 */
const PRESETS_PATTERN = /^\/fnf\/[^/]+\/presets(?:\/|$)/;

/**
 * Kept under a denylisted prefix: the wallet balance is the cross-check for
 * refund/wallet reconciliation (#17), so it survives even though everything else
 * under `/fnf/workspaces` is dropped. Prefix match keeps `/fnf/workspaces/wallet`
 * and any sub-resource (e.g. `/wallet/transactions`).
 */
const WORKSPACES_WALLET_PREFIX = '/fnf/workspaces/wallet';

/**
 * True when a captured URL is known non-generation noise that should not be
 * retained (ADR-0007). Checkable rule: deny iff the pathname starts with a
 * denylisted prefix (or matches the per-model presets shape) AND is not the
 * carved-out wallet endpoint. Anything unclassifiable (unparseable URL, or a
 * path we don't recognise) is kept — ADR-0001's breadth is the default, and the
 * denylist only removes traffic we have positively identified as noise.
 */
export function isDenylistedCaptureUrl(url: string): boolean {
  const path = pathnameOf(url);
  if (path === null) return false;
  // Carve-out wins over the `/fnf/workspaces` prefix below.
  if (path === WORKSPACES_WALLET_PREFIX || path.startsWith(`${WORKSPACES_WALLET_PREFIX}/`)) {
    return false;
  }
  if (PRESETS_PATTERN.test(path)) return true;
  return DENYLISTED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * The content of a raw capture that identifies it, i.e. everything except its
 * capture time and the Convex row metadata. Two captures with identical content
 * carry identical information regardless of when each was observed.
 */
export type RawCaptureContent = {
  method: string;
  url: string;
  status: number;
  requestBody: string | null;
  responseBody: string | null;
};

/**
 * True when `current` is byte-for-byte identical (ignoring capture time) to the
 * immediately-preceding capture for the same URL (ADR-0007). This collapses the
 * tool's repeated status polls — `GET /fnf/jobs/{id}` and
 * `POST /fnf/jobs/status-batch` return the same body until a job's status
 * actually changes, so a transition always differs and is always retained.
 *
 * Deliberately general (not status-poll-specific): identical content is zero new
 * information by definition, so dropping it never loses replay fidelity. A real
 * generate call is never a duplicate — its response carries a fresh job-set id.
 */
export function isDuplicateCapture(
  previous: RawCaptureContent,
  current: RawCaptureContent,
): boolean {
  return (
    previous.method === current.method &&
    previous.url === current.url &&
    previous.status === current.status &&
    previous.requestBody === current.requestBody &&
    previous.responseBody === current.responseBody
  );
}
