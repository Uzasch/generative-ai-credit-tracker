import type { GenerationEvent, JobOutcome, RefundState } from '@token-tracker/shared';
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

const recordRawCapture = makeFunctionReference<'mutation'>(
  'rawCaptures:record',
) as FunctionReference<'mutation', 'public', RawCapture, string>;

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
