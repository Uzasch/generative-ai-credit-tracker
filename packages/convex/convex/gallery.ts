import {
  type AssignmentState,
  type JobOutcome,
  type RefundState,
  type ResultMedia,
  type Tool,
  mediaKindOf,
} from '@token-tracker/shared';

/**
 * Pure view projection for the Generation Gallery (issue #7). Kept side-effect
 * free and free of any `_generated` runtime import — like `rollups.ts` — so it is
 * unit-testable directly (AGENTS.md §9) and reused by every gallery query in
 * `events.ts`.
 *
 * The gallery shows a Generation event as prompt + Result media + Cost
 * (CONTEXT.md). It never re-declares the event shape (AGENTS.md §6): this is a
 * read-only projection of the canonical `GenerationEvent`, deriving its fields
 * from `@token-tracker/shared`.
 */

/**
 * The event fields the gallery projection reads. A `Doc<'events'>` is structurally
 * assignable to this, so the queries pass their documents straight in without a
 * `_generated` type dependency leaking into this pure module.
 */
export type GalleryEventInput = {
  _id: string;
  tool: Tool;
  userId: string;
  brandId: string;
  assetId: string;
  assignment: AssignmentState;
  prompt?: string;
  cost: number;
  refund: RefundState;
  jobs: readonly JobOutcome[];
  capturedAt: number;
};

/**
 * One generation as the gallery renders it: its Assignment target id, attribution
 * axes, prompt, Cost, and the Result media of its completed jobs. `assetId` is the
 * real Asset once assigned, or the `'unattributed'` sentinel while it awaits
 * Assignment (mirrored by `assignment.status`).
 */
export type GenerationView = {
  /** Event id — the target an `assignAsset` triage passes back. */
  id: string;
  tool: Tool;
  userId: string;
  brandId: string;
  assetId: string;
  assignment: AssignmentState;
  prompt?: string;
  /** Internal cost unit as captured; displayed credits are `cost / 100` (ADR-0005). */
  cost: number;
  /**
   * Refund state of this generation. Carried so the gallery can aggregate NET
   * usage (charged `cost` minus any refunded amount) — refunds net out, they
   * never delete history (AGENTS.md §6). Summing raw `cost` would overstate a
   * tray/ledger total once a generation is refunded.
   */
  refund: RefundState;
  /**
   * Result media — one per completed job that has produced its output, each
   * tagged `image` or `video` so the gallery renders `<video>` vs `<img>` from an
   * explicit kind (a video URL in an `<img>` shows a broken object). The kind is
   * derived from the URL here, once, because a `JobOutcome` carries no media type.
   */
  media: ResultMedia[];
  /** Total jobs in the set, so the UI can show "N of M rendered". */
  jobCount: number;
  capturedAt: number;
};

/**
 * Result media (CONTEXT.md) for a job set: the output URL each *completed* Job has
 * produced, in job order. A failed/`nsfw` job yields none; a job seen `completed`
 * before its `results.raw.url` arrived (issue #4) contributes nothing until a
 * later poll attaches the URL.
 */
export function resultMedia(jobs: readonly JobOutcome[]): ResultMedia[] {
  const media: ResultMedia[] = [];
  for (const job of jobs) {
    if (job.status === 'completed' && job.mediaUrl !== undefined) {
      // Classify image vs video at the projection edge (the job carries only the
      // URL, no media type), so renderers switch on an explicit kind.
      media.push({ url: job.mediaUrl, kind: mediaKindOf(job.mediaUrl) });
    }
  }
  return media;
}

/** Project one stored event into the gallery's read-only view shape. */
export function toGenerationView(event: GalleryEventInput): GenerationView {
  return {
    id: event._id,
    tool: event.tool,
    userId: event.userId,
    brandId: event.brandId,
    assetId: event.assetId,
    assignment: event.assignment,
    prompt: event.prompt,
    cost: event.cost,
    refund: event.refund,
    media: resultMedia(event.jobs),
    jobCount: event.jobs.length,
    capturedAt: event.capturedAt,
  };
}
