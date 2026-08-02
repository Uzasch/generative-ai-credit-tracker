'use client';

import { ConvexProvider, ConvexReactClient } from 'convex/react';
import type { ReactNode } from 'react';

/**
 * Convex client for the dashboard. The deployment URL is the public endpoint,
 * injected at build time (`NEXT_PUBLIC_CONVEX_URL`) — never a secret. Created once
 * per module load, mirroring the extension popup's client setup.
 */
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
const convex = CONVEX_URL ? new ConvexReactClient(CONVEX_URL) : null;

/** True when a Convex deployment is configured — the page uses this to pick its backing container. */
export const convexConfigured = convex !== null;

/**
 * Wraps children in a `ConvexProvider` when a deployment is configured. When it is
 * not, children render without the provider (the page then mounts the synthetic
 * container, which calls no Convex hooks) — the same conditional the popup uses.
 */
export function ConvexClientProvider({ children }: { children: ReactNode }): JSX.Element {
  if (!convex) return <>{children}</>;
  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
