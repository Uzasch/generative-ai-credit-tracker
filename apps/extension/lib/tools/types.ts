import type { GenerationEvent, Tool } from '@token-tracker/shared';

/** A network response observed in the page's MAIN world. */
export type CapturedResponse = {
  url: string;
  method: string;
  status: number;
  /** Parsed JSON body, if the response was JSON. Untrusted — validate before use. */
  body: unknown;
};

/**
 * One adapter per tool. Given a captured response, decide whether it represents
 * a billable generation (or a refund) and extract the fields we can see here.
 * Return null for responses the adapter doesn't care about.
 *
 * The adapter cannot know userId/brandId/assetId on its own — it fills in what
 * the tool exposes (cost, toolRef, refund) and leaves attribution to the caller.
 */
export type ToolAdapter = {
  tool: Tool;
  /** URL substrings that indicate a response worth inspecting. */
  matches: (url: string) => boolean;
  extract: (res: CapturedResponse) => ExtractedUsage | null;
};

export type ExtractedUsage = Pick<GenerationEvent, 'cost' | 'toolRef'> & {
  refund?: GenerationEvent['refund'];
  /** Best-effort asset hint from the tool, if present (e.g. a job/project id). */
  assetHint?: string;
};
