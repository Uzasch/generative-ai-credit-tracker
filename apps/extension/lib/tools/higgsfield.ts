import type { CapturedResponse, ExtractedUsage, ToolAdapter } from './types';

/**
 * Higgsfield (AI image/video) adapter.
 *
 * Recognises the **generate** response — `POST /fnf/jobs/{type}` and
 * `POST /fnf/jobs/v2/{type}` — and pulls the billed Cost, the job-set id
 * (`toolRef`), the prompt, and the child job ids out of it. Everything else on
 * that host (`/fnf/user`, `/fnf/tours`, `GET /fnf/jobs/{id}` status polls,
 * `POST /fnf/jobs/status-batch`, …) is not a new generation and yields `null`.
 *
 * Recognition is deterministic — a URL-shape check plus the `job_sets` response
 * shape — never a guess (ADR-0002). Attribution is not the adapter's job; it
 * fills in only what the tool exposes and leaves user/brand/asset to the caller.
 */
export const higgsfieldAdapter: ToolAdapter = {
  tool: 'higgsfield',
  matches: (url) => url.includes('higgsfield.ai'),
  extract: (res) => extractGeneration(res),
};

/**
 * POSTs to `/fnf/jobs/{segment}` that share the prefix but are not a generate
 * call. Status polls (`GET /fnf/jobs/{id}`) are excluded by the POST-only check.
 */
const NON_GENERATE_SEGMENTS = new Set(['status-batch', 'accessible']);

/** A generate call is `POST /fnf/jobs/{type}` or `POST /fnf/jobs/v2/{type}`. */
function isGenerateRequest(res: CapturedResponse): boolean {
  if (res.method.toUpperCase() !== 'POST') return false;
  const path = pathnameOf(res.url);
  if (path === null) return false;
  // Exactly one model-type segment, optionally under a `v2/` prefix.
  const match = path.match(/^\/fnf\/jobs\/(?:v2\/)?([^/]+)\/?$/);
  const segment = match?.[1];
  if (segment === undefined) return false;
  return !NON_GENERATE_SEGMENTS.has(segment);
}

function extractGeneration(res: CapturedResponse): ExtractedUsage | null {
  if (!isGenerateRequest(res)) return null;

  const body = res.body;
  if (!isRecord(body)) return null;

  // Event = one Job set. Observed generate responses carry exactly one job set;
  // batch/multi-set behaviour is unconfirmed and parked (spec, ADR-0001).
  const jobSets = body.job_sets;
  if (!Array.isArray(jobSets) || jobSets.length === 0) return null;
  const jobSet = jobSets[0];
  if (!isRecord(jobSet)) return null;

  const toolRef = jobSet.id;
  if (typeof toolRef !== 'string') return null;

  const cost = readCost(jobSet.cost);
  if (cost === undefined) return null;

  return {
    cost,
    toolRef,
    prompt: readPrompt(jobSet.params),
    jobIds: readJobIds(jobSet.jobs),
  };
}

/**
 * Cost is the internal credit unit exactly as captured (ADR-0005): a paid
 * generation charges a number, a free one reports `null` ⇒ 0. Any other shape
 * means this is not a generate response we recognise ⇒ `undefined` (reject).
 */
function readCost(cost: unknown): number | undefined {
  if (cost === null) return 0;
  if (typeof cost === 'number' && Number.isFinite(cost)) return cost;
  return undefined;
}

function readPrompt(params: unknown): string | undefined {
  if (!isRecord(params)) return undefined;
  return typeof params.prompt === 'string' ? params.prompt : undefined;
}

/** The generate response lists its child jobs; we keep their ids in order. */
function readJobIds(jobs: unknown): string[] {
  if (!Array.isArray(jobs)) return [];
  const ids: string[] = [];
  for (const job of jobs) {
    if (isRecord(job) && typeof job.id === 'string') ids.push(job.id);
  }
  return ids;
}

/** Pathname of a URL, or null when it cannot be parsed. */
function pathnameOf(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
