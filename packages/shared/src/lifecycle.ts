import type { AnomalyEvidence } from './anomaly';
import type { JobOutcome, RefundState, Tool } from './index';

/**
 * The live status one recorded generation shows in the extension's tracking
 * indicator (issue #18). A single string-literal union (AGENTS.md §4 — no enums,
 * no booleans-with-flags) so the popup row and the toolbar signal read one field
 * instead of re-deriving the lifecycle from scattered flags.
 *
 * The lifecycle is a linear progression with three terminal branches:
 *
 *   tracked → generating → generated
 *                        ↘ refunded
 *                        ↘ flagged
 *
 *  - `tracked`    — the event was recorded but carries no jobs yet (issue #3): we
 *                   captured the charge, no job outcome has been observed.
 *  - `generating` — at least one job is still `queued`/`in_progress` (issue #4).
 *  - `generated`  — every job reached a terminal state and none failed, so the
 *                   media is available; the row shows the Cost.
 *  - `refunded`   — a non-`completed` terminal drove a full refund (issue #17,
 *                   finding refund-signal-nsfw.md): net usage is 0, the row shows
 *                   the credited-back amount. A failure terminal is surfaced here,
 *                   via the refund transition, not as its own status.
 *  - `flagged`    — a Flagged anomaly references this generation (issue #8): the
 *                   runtime could not confidently classify something about it, so
 *                   it needs a human. Highest precedence — an unresolved anomaly
 *                   outranks any billing outcome the row would otherwise show.
 */
export type LifecycleStatus = 'tracked' | 'generating' | 'generated' | 'refunded' | 'flagged';

/**
 * One row of the extension's live tracking indicator (issue #18): a recent
 * generation as the popup list renders it, and the shape the org-scoped
 * `recentGenerations` Convex query returns. Cross-cutting (Convex output + popup
 * input), so it lives here in the single source of truth (AGENTS.md §6) rather
 * than in the backend package. Deliberately lean — the indicator needs the
 * lifecycle status, the Cost/refund figures and enough identity to render and key
 * the row, not the gallery's media array or attribution axes.
 */
export type RecentGenerationView = {
  /** Event id — stable React key and the target any row action would pass back. */
  id: string;
  tool: Tool;
  prompt?: string;
  /**
   * Internal cost unit as captured; displayed credits are `cost / 100` (ADR-0005).
   * The row shows this as the Cost once `generated`.
   */
  cost: number;
  /** The live lifecycle status the row's label/icon renders. */
  status: LifecycleStatus;
  /**
   * Refund state, carried so a `refunded` row can show the credited-back amount
   * and convey the net-0 outcome (refunds net out, never delete — AGENTS.md §6).
   */
  refund: RefundState;
  /** Total jobs in the set — lets the row show "N of M rendered" progress. */
  jobCount: number;
  /** Jobs that have completed — the numerator of that progress. */
  completedCount: number;
  /** Client capture time, ms since epoch — the row orders newest-first on it. */
  capturedAt: number;
};

/** A job is still in flight (non-terminal) while it is `queued` or `in_progress`. */
function isActiveJob(status: JobOutcome['status']): boolean {
  return status === 'queued' || status === 'in_progress';
}

/**
 * Derive the {@link LifecycleStatus} of one generation from its own recorded
 * fields plus whether a Flagged anomaly references it. Pure and total (no I/O, no
 * clock) so it is unit-testable and shared verbatim by the Convex query that
 * feeds the popup and any other surface (AGENTS.md §6 — one source of truth).
 *
 * Precedence is deliberate and documented, because the states are not strictly
 * mutually exclusive at the data level:
 *
 *  1. `flagged`   — an unresolved anomaly is the signal a human must see, so it
 *                   outranks a billing outcome (e.g. a cost-mismatch on an event
 *                   that also completed still surfaces as flagged).
 *  2. `refunded`  — a confirmed reversal is a resolved terminal (net 0); it wins
 *                   over the job-derived states so a refunded generation never
 *                   reads as merely `generated`.
 *  3. job-derived — no jobs ⇒ `tracked`; any active job ⇒ `generating`; otherwise
 *                   all jobs are terminal ⇒ `generated`. (A lone failed job is
 *                   already caught by the refund transition above; a deferred
 *                   partial-batch failure — spec/ADR-0001 — that produced media
 *                   reads as `generated`, which is the least-wrong bucket until
 *                   per-job refund reconciliation lands.)
 */
export function lifecycleStatus(input: {
  jobs: readonly Pick<JobOutcome, 'status'>[];
  refund: RefundState;
  hasAnomaly: boolean;
}): LifecycleStatus {
  if (input.hasAnomaly) return 'flagged';
  if (input.refund.kind === 'refunded') return 'refunded';
  if (input.jobs.length === 0) return 'tracked';
  if (input.jobs.some((job) => isActiveJob(job.status))) return 'generating';
  return 'generated';
}

/**
 * The tool-side references a batch of Flagged anomalies point at, indexed for a
 * fast per-event lookup. Built once per org read (the anomaly set is org-scoped)
 * so classifying N events is O(N), not O(N·anomalies).
 *
 *  - `toolRefs` — job-set ids carried on an anomaly row (`cost-mismatch` sets one;
 *    a raw `click-no-request` does not), matched against an event's `toolRef`.
 *  - `jobIds`   — job ids inside `unknown-status` evidence, matched against an
 *    event's `jobs[].jobId` (that anomaly carries no top-level `toolRef`, so its
 *    only link back to the event is the offending job).
 */
export type AnomalyRefs = {
  toolRefs: ReadonlySet<string>;
  jobIds: ReadonlySet<string>;
};

/** Collect the anomaly→event links from an org's Flagged anomaly rows. */
export function collectAnomalyRefs(
  anomalies: readonly { toolRef?: string; evidence: AnomalyEvidence }[],
): AnomalyRefs {
  const toolRefs = new Set<string>();
  const jobIds = new Set<string>();
  for (const anomaly of anomalies) {
    if (anomaly.toolRef !== undefined) toolRefs.add(anomaly.toolRef);
    // `unknown-status` carries no top-level toolRef; its link to an event is the
    // job whose status could not be classified.
    if (anomaly.evidence.kind === 'unknown-status') jobIds.add(anomaly.evidence.jobId);
  }
  return { toolRefs, jobIds };
}

/**
 * Whether a Flagged anomaly references this generation — by its job-set `toolRef`
 * or by one of its job ids. Pure lookup against the pre-built {@link AnomalyRefs};
 * the result feeds `lifecycleStatus`'s `hasAnomaly`.
 */
export function isEventFlagged(
  event: { toolRef?: string; jobs: readonly Pick<JobOutcome, 'jobId'>[] },
  refs: AnomalyRefs,
): boolean {
  if (event.toolRef !== undefined && refs.toolRefs.has(event.toolRef)) return true;
  return event.jobs.some((job) => refs.jobIds.has(job.jobId));
}
