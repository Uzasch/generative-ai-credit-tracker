import type { GenerationView } from '@/lib/convex';

/**
 * A collection an object can be accessioned into — one Asset, named with its
 * owning Brand for context. Assignment targets are always real Assets, never the
 * `'unattributed'` sentinel (CONTEXT.md). In production these come from entity
 * management (out of scope, issue #5); the gallery only needs the id + labels.
 */
export type GalleryAsset = {
  assetId: string;
  name: string;
  brandId: string;
  brandName: string;
};

/**
 * Everything the presentational gallery renders, supplied by a container (Convex
 * or synthetic). Keeping it prop-driven honors AGENTS.md §7 — the component holds
 * no fetch logic; data arrives from the container's Convex hooks.
 */
export type GalleryData = {
  organizationName: string;
  editorName: string;
  /** The intake tray: unattributed generations awaiting Assignment. */
  intake: GenerationView[];
  /** The editor's accessioned (assigned) generations — the per-Editor feed. */
  feed: GenerationView[];
  /** Collections available as Assignment targets. */
  assets: GalleryAsset[];
  /** True while a backing query is still loading. */
  loading: boolean;
  /**
   * Perform an Assignment. Resolves when the write is accepted; the container is
   * responsible for reflecting the change (reactively via Convex, or in local
   * state for the synthetic demo).
   */
  onAssign: (eventId: string, assetId: string) => void | Promise<void>;
};
