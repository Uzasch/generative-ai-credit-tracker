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
 * a billable generation, a passive outcome update, or nothing we care about,
 * and extract the fields we can see here. Return null for responses the adapter
 * doesn't care about.
 *
 * The adapter cannot know userId/brandId/assetId on its own — it fills in what
 * the tool exposes (cost, toolRef, refund, job outcomes) and leaves attribution
 * and correlation to the caller.
 */
export type ToolAdapter = {
  tool: Tool;
  /** URL substrings that indicate a response worth inspecting. */
  matches: (url: string) => boolean;
  extract: (res: CapturedResponse) => ExtractedUsage | null;
  /**
   * Whether this capture is a **generate request** — the call a Generate click
   * fires — decided from the request shape (method + URL) alone, independent of
   * whether {@link extract} can read a structured event from the body. The click
   * tripwire (#8) correlates observed Generate clicks against this so a request
   * that errored still counts as "a request happened" (only a click with *no*
   * request in the window is a `click-no-request` anomaly). Optional: a tool
   * whose generate shape isn't known yet omits it.
   */
  isGenerateRequest?: (res: CapturedResponse) => boolean;
};

/**
 * A recognised **new generation** — the generate response that creates the
 * event and its charge. Attribution-free; the caller stamps user/brand/asset.
 */
export type ExtractedGeneration = Pick<GenerationEvent, 'cost' | 'toolRef' | 'toolAccount'> & {
  kind: 'generation';
  /** The generation prompt when the response carries one. */
  prompt?: string;
  /**
   * Child job ids of the generate response's job set — one per requested output
   * (event = one Job set). Their status/result media are observed later via the
   * tool's own status polls (see `ExtractedStatus`); the adapter does not invent
   * outcomes on the generate response (ADR-0002).
   */
  jobIds: string[];
  refund?: GenerationEvent['refund'];
  /** Best-effort asset hint from the tool, if present (e.g. a job/project id). */
  assetHint?: string;
};

/**
 * One job's observed outcome, read passively from a status poll. `status` is the
 * raw string off the wire — the caller maps known values to a `JobStatus` and
 * flags anything else rather than guessing (ADR-0002; unknown-status flag is
 * issue #8). `mediaUrl` is present once the tool reports a result.
 */
export type JobStatusUpdate = {
  jobId: string;
  status: string;
  mediaUrl?: string;
};

/**
 * A recognised **status update** — the tool's own polling traffic reporting how
 * previously-recorded jobs are progressing. Carries no cost and creates no
 * event; the caller correlates each update to its originating event by job id.
 */
export type ExtractedStatus = {
  kind: 'status';
  updates: JobStatusUpdate[];
};

/**
 * What an adapter pulls out of a captured response: either a new generation or
 * a passive outcome update. Distinguished by `kind` so the caller records a new
 * event versus patching an existing one.
 */
export type ExtractedUsage = ExtractedGeneration | ExtractedStatus;
