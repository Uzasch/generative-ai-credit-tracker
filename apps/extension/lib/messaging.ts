import type { RawCapture } from './tools';

/** Marker on window messages posted from the MAIN-world patch to the bridge. */
export const CAPTURE_SOURCE = 'tt-capture' as const;

/** The only API host whose traffic we capture (ADR-0001). */
export const CAPTURE_HOST = 'fnf-api-gw.higgsfield.ai';

export type CaptureMessage = {
  source: typeof CAPTURE_SOURCE;
  payload: RawCapture;
};

/** True only for `https://fnf-api-gw.higgsfield.ai/...` URLs. */
export function isCaptureHostUrl(url: string): boolean {
  try {
    return new URL(url).host === CAPTURE_HOST;
  } catch {
    return false;
  }
}

/**
 * Validate a window message as a well-formed capture. The MAIN world is shared
 * with the page, so any script can post our marker — we trust nothing here and
 * fully validate the payload shape before it is forwarded or stored (AGENTS.md
 * §4). Host enforcement is applied separately at the background trust boundary.
 */
export function isCaptureMessage(data: unknown): data is CaptureMessage {
  if (typeof data !== 'object' || data === null) return false;
  const msg = data as { source?: unknown; payload?: unknown };
  if (msg.source !== CAPTURE_SOURCE) return false;
  return isRawCapture(msg.payload);
}

function isRawCapture(value: unknown): value is RawCapture {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<keyof RawCapture, unknown>;
  return (
    typeof p.url === 'string' &&
    typeof p.method === 'string' &&
    typeof p.status === 'number' &&
    (typeof p.requestBody === 'string' || p.requestBody === null) &&
    (typeof p.responseBody === 'string' || p.responseBody === null) &&
    typeof p.capturedAt === 'number'
  );
}

/**
 * Marker on window messages posted from the MAIN-world patch the INSTANT a
 * captured request is fired — before its response arrives. The click tripwire
 * (#8) correlates Generate clicks against request *start* times: the normal
 * capture message only lands after the response body is read, so a slow generate
 * POST would otherwise be flagged as "no request" before its capture arrived.
 */
export const REQUEST_STARTED_SOURCE = 'tt-request-started' as const;

/** Minimal request-start signal: enough to recognise a generate request by shape. */
export type RequestStartedPayload = {
  url: string;
  method: string;
  /** When the request was fired (synchronously, before the fetch), ms since epoch. */
  startedAt: number;
};

export type RequestStartedMessage = {
  source: typeof REQUEST_STARTED_SOURCE;
  payload: RequestStartedPayload;
};

/** Validate a window/runtime message as a well-formed request-start signal. */
export function isRequestStartedMessage(data: unknown): data is RequestStartedMessage {
  if (typeof data !== 'object' || data === null) return false;
  const msg = data as { source?: unknown; payload?: unknown };
  if (msg.source !== REQUEST_STARTED_SOURCE) return false;
  const p = msg.payload;
  if (typeof p !== 'object' || p === null) return false;
  const payload = p as { url?: unknown; method?: unknown; startedAt?: unknown };
  return (
    typeof payload.url === 'string' &&
    typeof payload.method === 'string' &&
    typeof payload.startedAt === 'number'
  );
}

/** Marker on runtime messages posted from the ISOLATED-world click tripwire. */
export const GENERATE_CLICK_SOURCE = 'tt-generate-click' as const;

/** Payload the tripwire reports for each observed Generate click. */
export type GenerateClickPayload = {
  /** Page host the click happened on (maps to a Tool in the background). */
  host: string;
  /** When the click fired, client ms epoch. */
  clickedAt: number;
};

export type GenerateClickMessage = {
  source: typeof GENERATE_CLICK_SOURCE;
  payload: GenerateClickPayload;
};

/**
 * Validate a runtime message as a well-formed Generate-click report. The tripwire
 * runs in the ISOLATED world (it has `browser.runtime` and sends directly, no
 * page-shared MAIN world), but we still fully validate the shape at the background
 * trust boundary before acting on it (AGENTS.md §4).
 */
export function isGenerateClickMessage(data: unknown): data is GenerateClickMessage {
  if (typeof data !== 'object' || data === null) return false;
  const msg = data as { source?: unknown; payload?: unknown };
  if (msg.source !== GENERATE_CLICK_SOURCE) return false;
  const p = msg.payload;
  if (typeof p !== 'object' || p === null) return false;
  const payload = p as { host?: unknown; clickedAt?: unknown };
  return typeof payload.host === 'string' && typeof payload.clickedAt === 'number';
}

/** Hosts the capture + bridge scripts run on. Keep in sync with wxt.config host_permissions. */
export const TOOL_MATCHES = [
  'https://labs.google/*',
  'https://*.higgsfield.ai/*',
  'https://*.klingai.com/*',
];

/**
 * Hosts the click tripwire runs on: ONLY tools whose adapter recognises generate
 * requests (`isGenerateRequest`). If the tripwire ran on a tool without that
 * recognition (Flow, Kling today), every Generate click there would be flagged
 * `click-no-request` because its real request is never matched. Add a host here
 * once its adapter implements generate-request recognition (#8).
 */
export const TRIPWIRE_MATCHES = ['https://*.higgsfield.ai/*'];
