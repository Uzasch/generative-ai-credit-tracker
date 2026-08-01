import { isCaptureMessage } from '@/lib/messaging';
import { extractUsage } from '@/lib/tools';

/**
 * Background: receives raw captures, runs the tool adapters to extract usage,
 * attributes it (user/brand/asset), and records it to Convex.
 */
export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: unknown) => {
    if (!isCaptureMessage(message)) return;
    const result = extractUsage(message.payload);
    if (!result) return;

    // TODO: attribution — resolve current userId, brandId, assetId (open Qs 1-2),
    // then call the Convex `events.record` mutation. For now, log the signal.
    console.debug('[token-tracker] usage captured', result.tool, result.usage);
  });
});
