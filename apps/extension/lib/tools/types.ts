import type { GenerationEvent, Tool } from '@token-tracker/shared';

/**
 * A raw request/response pair observed in the page's MAIN world and retained
 * verbatim (ADR-0001). Bodies are unparsed strings; request headers are never
 * captured, so no auth token is present. This is the wire payload from the
 * MAIN-world probe to the background.
 */
export type RawCapture = {
  url: string;
  method: string;
  status: number;
  /** Serialized request body, or null when the request had none. */
  requestBody: string | null;
  /** Raw response body text, or null when it could not be read. */
  responseBody: string | null;
  /** Client capture time, ms since epoch. */
  capturedAt: number;
};

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

export type ExtractedUsage = Pick<GenerationEvent, 'cost' | 'toolRef' | 'toolAccount'> & {
  /** The generation prompt when the response carries one. */
  prompt?: string;
  /**
   * Child job ids of the generate response's job set — one per requested output
   * (event = one Job set). Their status/result media are observed later via the
   * tool's own status polls (a subsequent ticket); the adapter does not invent
   * outcomes here (ADR-0002).
   */
  jobIds: string[];
  refund?: GenerationEvent['refund'];
  /** Best-effort asset hint from the tool, if present (e.g. a job/project id). */
  assetHint?: string;
};
