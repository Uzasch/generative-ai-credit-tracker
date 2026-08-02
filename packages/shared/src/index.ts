/**
 * Shared domain types for Token Tracker for AI Generation.
 *
 * This is the single source of truth for the generation-event shape.
 * Imported by the extension, the dashboard, and the Convex backend.
 * See AGENTS.md §6. Do not re-declare these shapes elsewhere.
 */

/** The AI-generation tools we track. Add a tool here + an adapter, nothing else. */
export const TOOLS = ['flow', 'higgsfield', 'kling'] as const;
export type Tool = (typeof TOOLS)[number];

/** A charge can later be reversed. Refunds net out — they never delete history. */
export type RefundState =
  | { kind: 'none' }
  | { kind: 'pending' }
  | { kind: 'refunded'; amount: number; at: number };

/**
 * Whether the event is attributed to an Asset. `'needs-assignment'` is the
 * explicit flag on an Unattributed Generation event (its `assetId` is the
 * `'unattributed'` sentinel); an editor later resolves it via Assignment
 * (CONTEXT.md), flipping it to `'assigned'`. Distinct from a Flagged anomaly.
 */
export type AssignmentState = { status: 'assigned' } | { status: 'needs-assignment' };

/**
 * Lifecycle of a single job within a generation's job set. `completed` is the
 * only success terminal; the rest of the terminals are failures (see
 * `FAILURE_STATUSES`). `nsfw` is a content-safety rejection observed in real
 * Higgsfield traffic, which the tool fully refunds
 * (.scratch/higgsfield-tracking/findings/refund-signal-nsfw.md).
 */
export const JOB_STATUSES = ['queued', 'in_progress', 'completed', 'failed', 'nsfw'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * Terminal statuses that mean the job did not succeed. A non-`completed`
 * terminal ⇒ the tool refunds the job-set cost, and the indicator surfaces it as
 * a failure. Both refund detection (#17) and the failure indicator (#18) key off
 * this one list. Add new failure strings here as captures reveal them.
 */
export const FAILURE_STATUSES = ['failed', 'nsfw'] as const;
export type FailureStatus = (typeof FAILURE_STATUSES)[number];

/**
 * One child job of a generation. A single generate click is one charge holding
 * N jobs; each job resolves independently and carries its own result media.
 */
export type JobOutcome = {
  /** Tool-side job id, polled for status/result. */
  jobId: string;
  status: JobStatus;
  /** Result media URL, present once the job completes. */
  mediaUrl?: string;
};

/**
 * The core recorded unit: one generate action that consumes tokens/credits.
 * Roll-ups: event -> asset -> brand, and independently event -> user.
 */
export type GenerationEvent = {
  /** Single tenant that owns every roll-up. Top of the org -> brand -> asset tree. */
  organizationId: string;
  /** The editor who triggered the generation. */
  userId: string;
  tool: Tool;
  /** IP / brand — the top-level roll-up entity. */
  brandId: string;
  /**
   * Song / video / image. Shared across users: same asset aggregates usage.
   * The `'unattributed'` sentinel marks a real charge with no Active Asset —
   * it rolls up to the brand but not to any asset.
   */
  assetId: string | 'unattributed';
  /** The generation prompt, when captured. */
  prompt?: string;
  /** Tokens or credits consumed by this event. */
  cost: number;
  /** Child jobs of this generation; may be empty. */
  jobs: JobOutcome[];
  refund: RefundState;
  /**
   * Whether this event is attributed to an Asset. `'needs-assignment'` when
   * captured with no Active Asset (mirrors the `'unattributed'` `assetId`
   * sentinel); resolved to `'assigned'` by Assignment.
   */
  assignment: AssignmentState;
  /** Client capture time, ms since epoch. */
  capturedAt: number;
  /** Tool-side job/request id, used to reconcile refunds. */
  toolRef?: string;
  /** Shared-seat tool account, captured as metadata only (ADR-0004). */
  toolAccount?: string;
  /** Version of the discovery rules that produced this event (ADR-0003). */
  ruleVersion: number;
};

/** Type guard for untrusted values coming off the wire / captured traffic. */
export function isTool(value: unknown): value is Tool {
  return typeof value === 'string' && (TOOLS as readonly string[]).includes(value);
}

// Attribution: the pure step that stamps a tool-extracted generation with the
// editor's Active context, or flags it when no Active Asset is selected.
export {
  type ActiveContext,
  type ExtractedGeneration,
  type FlaggedAnomaly,
  attribute,
  isFlaggedAnomaly,
} from './attribute';

// Seed selection catalog for the popup's Org → Brand → Asset picker + login roster.
export type { SeedAsset, SeedBrand, SeedCatalog, SeedOrg, SeedUser } from './seed';

// Refund detection: the pure step that turns a failure-terminal job status into
// a `refunded` transition, and the independent wallet-delta cross-check of its
// amount (issue #17).
export {
  type RefundMismatch,
  type Refunded,
  assertRefundAmount,
  crossCheckRefund,
  isValidRefundAmount,
  refundForStatus,
} from './refund';

/**
 * Type guard for a job status observed in captured traffic. A status string we
 * don't recognise is never coerced — the caller flags it instead of guessing
 * (ADR-0002; unknown-status flag is issue #8).
 */
export function isJobStatus(value: unknown): value is JobStatus {
  return typeof value === 'string' && (JOB_STATUSES as readonly string[]).includes(value);
}

/**
 * Type guard for a non-`completed` terminal failure status. Lets refund
 * detection (#17) and the failure indicator (#18) test a status without
 * re-declaring the failure set.
 */
export function isFailureStatus(value: unknown): value is FailureStatus {
  return typeof value === 'string' && (FAILURE_STATUSES as readonly string[]).includes(value);
}
