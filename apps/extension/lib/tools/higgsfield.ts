import type {
  CapturedResponse,
  ExtractedGeneration,
  ExtractedStatus,
  ExtractedUsage,
  JobStatusUpdate,
  ToolAdapter,
} from './types';

/**
 * Higgsfield (AI image/video) adapter. Recognises two kinds of response:
 *
 * - the **generate** response — `POST /fnf/jobs/{type}` and
 *   `POST /fnf/jobs/v2/{type}` — pulling the billed Cost, the job-set id
 *   (`toolRef`), the prompt, and the child job ids (a new generation); and
 * - the tool's own **status polls** — `GET /fnf/jobs/{id}` and
 *   `POST /fnf/jobs/status-batch` — producing passive Job outcome updates
 *   (status + `results.raw.url` media on completion). The extension issues no
 *   Higgsfield requests of its own; it only reads the tool's polling traffic
 *   (passive observation, ADR-0001).
 *
 * Everything else on that host (`/fnf/user`, `/fnf/tours`, …) yields `null`.
 * Recognition is deterministic — a URL-shape check plus the response body shape
 * — never a guess (ADR-0002). Attribution and correlation are not the adapter's
 * job; it fills in only what the tool exposes and leaves user/brand/asset and
 * the event-to-update correlation to the caller.
 */
export const higgsfieldAdapter: ToolAdapter = {
  tool: 'higgsfield',
  matches: (url) => url.includes('higgsfield.ai'),
  extract: (res): ExtractedUsage | null => extractGeneration(res) ?? extractStatus(res),
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

function extractGeneration(res: CapturedResponse): ExtractedGeneration | null {
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
    kind: 'generation',
    cost,
    toolRef,
    prompt: readPrompt(jobSet.params),
    jobIds: readJobIds(jobSet.jobs),
    // The tool-side `user_id` on each job is the shared Higgsfield seat, captured
    // as metadata only — never our editor identity (ADR-0004).
    toolAccount: readToolAccount(jobSet.jobs),
  };
}

/** A single status poll is `GET /fnf/jobs/{id}` (one id segment, no `v2/`). */
function isSingleStatusPoll(res: CapturedResponse): boolean {
  if (res.method.toUpperCase() !== 'GET') return false;
  const path = pathnameOf(res.url);
  if (path === null) return false;
  return /^\/fnf\/jobs\/[^/]+\/?$/.test(path);
}

/** The batch status poll is `POST /fnf/jobs/status-batch`. */
function isStatusBatch(res: CapturedResponse): boolean {
  if (res.method.toUpperCase() !== 'POST') return false;
  return pathnameOf(res.url) === '/fnf/jobs/status-batch';
}

/**
 * Recognise the tool's own status polls and turn them into passive Job outcome
 * updates. A single poll (`GET /fnf/jobs/{id}`) returns one job object at the top
 * level; the batch (`POST /fnf/jobs/status-batch`) returns
 * `{ items: [{ id, status, … }], missing: [...] }`. Both job shapes carry
 * `{ id, status }`; only the single poll carries the result media
 * (`results.raw.url`), so batch items advance status and the media arrives on the
 * per-job `GET` — confirmed against a captured multi-output batch.
 *
 * Returns `null` when nothing job-shaped is present, so a same-URL non-job body
 * (an error, `/fnf/jobs/accessible`) is not a status update.
 */
function extractStatus(res: CapturedResponse): ExtractedStatus | null {
  let jobObjects: unknown[];
  if (isSingleStatusPoll(res)) {
    jobObjects = [res.body];
  } else if (isStatusBatch(res)) {
    jobObjects = readBatchItems(res.body);
  } else {
    return null;
  }

  const updates: JobStatusUpdate[] = [];
  for (const obj of jobObjects) {
    const update = readJobUpdate(obj);
    if (update !== null) updates.push(update);
  }
  return updates.length > 0 ? { kind: 'status', updates } : null;
}

/** The status-batch response lists the polled jobs under `items`. */
function readBatchItems(body: unknown): unknown[] {
  if (!isRecord(body)) return [];
  return Array.isArray(body.items) ? body.items : [];
}

/**
 * Read one job object (`{ id, status, results? }`) into an outcome update. The
 * status string is passed through verbatim — mapping known values to a
 * `JobStatus` and flagging the rest is the caller's job (ADR-0002, issue #8).
 */
function readJobUpdate(obj: unknown): JobStatusUpdate | null {
  if (!isRecord(obj)) return null;
  const jobId = obj.id;
  if (typeof jobId !== 'string') return null;
  const status = obj.status;
  if (typeof status !== 'string') return null;
  const mediaUrl = readMediaUrl(obj.results);
  return mediaUrl === undefined ? { jobId, status } : { jobId, status, mediaUrl };
}

/** Result media lives at `results.raw.url` once a job completes. */
function readMediaUrl(results: unknown): string | undefined {
  if (!isRecord(results)) return undefined;
  const raw = results.raw;
  if (!isRecord(raw)) return undefined;
  return typeof raw.url === 'string' ? raw.url : undefined;
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

/**
 * The shared tool seat: every job in a set carries the same tool-side `user_id`,
 * so the first job's is representative. Undefined when the response omits it.
 */
function readToolAccount(jobs: unknown): string | undefined {
  if (!Array.isArray(jobs)) return undefined;
  for (const job of jobs) {
    if (isRecord(job) && typeof job.user_id === 'string') return job.user_id;
  }
  return undefined;
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
