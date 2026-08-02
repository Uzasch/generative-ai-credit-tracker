import type { GenerationEvent, JobOutcome, JobStatus, RefundState } from '@token-tracker/shared';
import { ConvexHttpClient } from 'convex/browser';
import { type FunctionReference, makeFunctionReference } from 'convex/server';
import type { RawCapture } from './tools';

/**
 * Convex client for the background service worker. The deployment URL is
 * injected at build time (VITE_CONVEX_URL) — never a secret, just the public
 * deployment endpoint. We reference functions by name to avoid importing the
 * convex package's generated `api` into the extension bundle.
 */
const CONVEX_URL = import.meta.env.VITE_CONVEX_URL as string | undefined;

// Returns the new row id, or `null` when the capture was intentionally not
// retained (denylisted or a duplicate status poll — ADR-0007). The caller
// ignores the value; the probe is fire-and-forget.
const recordRawCapture = makeFunctionReference<'mutation'>(
  'rawCaptures:record',
) as FunctionReference<'mutation', 'public', RawCapture, string | null>;

/**
 * Arguments for the `events.record` mutation. Derived from the single source of
 * truth for the event shape (`@token-tracker/shared`, AGENTS.md §6) — never
 * re-declared. The mutation defaults `jobs` and `refund` server-side, so both
 * are optional here.
 */
export type GenerationEventInput = Omit<GenerationEvent, 'jobs' | 'refund'> & {
  jobs?: JobOutcome[];
  refund?: RefundState;
};

const recordEvent = makeFunctionReference<'mutation'>('events:record') as FunctionReference<
  'mutation',
  'public',
  GenerationEventInput,
  string
>;

/** Arguments for the `events.applyJobStatus` mutation (passive outcome update). */
export type JobStatusUpdateInput = {
  /** Tenant that owns the event — correlation is scoped to it (ADR-0004). */
  organizationId: string;
  jobId: string;
  status: JobStatus;
  mediaUrl?: string;
  /**
   * When this poll drives a refund transition, the time to attribute it to —
   * the extension's capture time for this status poll (`capture.capturedAt`), so
   * the refund's `at` reflects when the terminal status was observed, not when
   * the mutation happened to be delivered. Optional: non-terminal polls (the
   * common case) need not supply it.
   */
  at?: number;
};

const applyJobStatus = makeFunctionReference<'mutation'>(
  'events:applyJobStatus',
) as FunctionReference<'mutation', 'public', JobStatusUpdateInput, string | null>;

let client: ConvexHttpClient | null = null;
function getClient(): ConvexHttpClient | null {
  if (!CONVEX_URL) return null;
  if (!client) client = new ConvexHttpClient(CONVEX_URL);
  return client;
}

/** Append one raw capture to Convex. Best-effort — never throws to the caller. */
export async function appendRawCapture(capture: RawCapture): Promise<void> {
  const c = getClient();
  if (!c) {
    console.warn('[token-tracker] VITE_CONVEX_URL not set — raw capture dropped');
    return;
  }
  try {
    await c.mutation(recordRawCapture, capture);
  } catch (err) {
    console.warn('[token-tracker] failed to append raw capture', err);
  }
}

/** Record one generation event to Convex. Best-effort — never throws to the caller. */
export async function recordGenerationEvent(event: GenerationEventInput): Promise<void> {
  const c = getClient();
  if (!c) {
    console.warn('[token-tracker] VITE_CONVEX_URL not set — generation event dropped');
    return;
  }
  try {
    await c.mutation(recordEvent, event);
  } catch (err) {
    console.warn('[token-tracker] failed to record generation event', err);
  }
}

/**
 * Apply one passively-observed job status update to its originating event.
 * Best-effort — never throws to the caller. Convex correlates by job id.
 */
export async function recordJobStatus(update: JobStatusUpdateInput): Promise<void> {
  const c = getClient();
  if (!c) {
    console.warn('[token-tracker] VITE_CONVEX_URL not set — job status update dropped');
    return;
  }
  try {
    await c.mutation(applyJobStatus, update);
  } catch (err) {
    console.warn('[token-tracker] failed to apply job status update', err);
  }
}
