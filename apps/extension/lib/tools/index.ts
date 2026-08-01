import { flowAdapter } from './flow';
import { higgsfieldAdapter } from './higgsfield';
import { klingAdapter } from './kling';
import type { CapturedResponse, ExtractedUsage, ToolAdapter } from './types';

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

export type { CapturedResponse, ExtractedUsage, ToolAdapter };
