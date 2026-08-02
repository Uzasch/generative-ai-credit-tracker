import { flowAdapter } from './flow';
import { higgsfieldAdapter } from './higgsfield';
import { klingAdapter } from './kling';
import type { CapturedResponse, ExtractedUsage, RawCapture, ToolAdapter } from './types';

export const ADAPTERS: readonly ToolAdapter[] = [flowAdapter, higgsfieldAdapter, klingAdapter];

/** Run a captured response through whichever adapter claims its URL. */
export function extractUsage(
  res: CapturedResponse,
): { tool: ToolAdapter['tool']; usage: ExtractedUsage } | null {
  for (const adapter of ADAPTERS) {
    if (!adapter.matches(res.url)) continue;
    const usage = adapter.extract(res);
    if (usage) return { tool: adapter.tool, usage };
  }
  return null;
}

/**
 * Whether a captured response is a **generate request** for its tool (the call a
 * Generate click fires), by request shape alone. Used by the click tripwire (#8)
 * to correlate observed Generate clicks against real requests. Returns false for
 * tools whose generate shape isn't known yet (adapters without `isGenerateRequest`).
 */
export function isGenerateRequest(res: CapturedResponse): boolean {
  for (const adapter of ADAPTERS) {
    if (!adapter.matches(res.url)) continue;
    if (adapter.isGenerateRequest?.(res)) return true;
  }
  return false;
}

export type { CapturedResponse, ExtractedUsage, RawCapture, ToolAdapter };
