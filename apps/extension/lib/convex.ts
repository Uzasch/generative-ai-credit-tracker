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
