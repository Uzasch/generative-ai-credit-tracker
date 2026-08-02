import type { RawCapture } from './tools';

/** Marker on window messages posted from the MAIN-world patch to the bridge. */
export const CAPTURE_SOURCE = 'tt-capture' as const;

export type CaptureMessage = {
  source: typeof CAPTURE_SOURCE;
  payload: RawCapture;
};

export function isCaptureMessage(data: unknown): data is CaptureMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { source?: unknown }).source === CAPTURE_SOURCE
  );
}

/** Hosts the capture + bridge scripts run on. Keep in sync with wxt.config host_permissions. */
export const TOOL_MATCHES = [
  'https://labs.google/*',
  'https://*.higgsfield.ai/*',
  'https://*.klingai.com/*',
];
