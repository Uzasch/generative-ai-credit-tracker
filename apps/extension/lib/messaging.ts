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

/** Hosts the capture + bridge scripts run on. Keep in sync with wxt.config host_permissions. */
export const TOOL_MATCHES = [
  'https://labs.google/*',
  'https://*.higgsfield.ai/*',
  'https://*.klingai.com/*',
];
