import type { GenerationEvent, ResultMedia, SeedCatalog } from '@token-tracker/shared';
import { type FunctionReference, makeFunctionReference } from 'convex/server';

/**
 * Convex function references for the Generation Gallery (issue #7). Referenced by
 * name — like the extension's `lib/convex.ts` and `lib/seed.ts` — so the
 * dashboard bundle never imports the convex package's generated `api`.
 *
 * The gallery view shape mirrors the Convex `toGenerationView` projection
 * (`packages/convex/convex/gallery.ts`). The dashboard cannot import that
 * internal convex module, so the shape is restated here — but its domain fields
 * are `Pick`ed from the single source of truth (`@token-tracker/shared`,
 * AGENTS.md §6), never re-declared; only the projection-only additions (`id`,
 * `media`, `jobCount`) are new.
 */
export type GenerationView = Pick<
  GenerationEvent,
  | 'tool'
  | 'userId'
  | 'brandId'
  | 'assetId'
  | 'assignment'
  | 'prompt'
  | 'cost'
  | 'refund'
  | 'capturedAt'
> & {
  /** Event id — the Assignment target passed back to `assignAsset`. */
  id: string;
  /**
   * Result media — one per completed job that produced its output, each tagged
   * `image` or `video` (mirrors the convex `toGenerationView` projection) so the
   * gallery renders `<video>` vs `<img>` from an explicit kind, not the URL.
   */
  media: ResultMedia[];
  /** Total jobs in the set, so the UI can show "N of M rendered". */
  jobCount: number;
};

/**
 * One editor's intake tray: their unattributed generations awaiting Assignment.
 * Scoped by `userId` as well as `organizationId` — the gallery is a single
 * editor's surface, so the tray mirrors the per-editor feed (ADR-0004).
 */
export const unattributedGenerationsRef = makeFunctionReference<'query'>(
  'events:unattributedGenerations',
) as FunctionReference<
  'query',
  'public',
  { organizationId: string; userId: string },
  GenerationView[]
>;

/** One editor's generations within an Organization — the per-Editor feed. */
export const generationsByUserRef = makeFunctionReference<'query'>(
  'events:generationsByUser',
) as FunctionReference<
  'query',
  'public',
  { organizationId: string; userId: string },
  GenerationView[]
>;

/** One Asset's generations within an Organization — the per-Asset browse view. */
export const generationsByAssetRef = makeFunctionReference<'query'>(
  'events:generationsByAsset',
) as FunctionReference<
  'query',
  'public',
  { organizationId: string; assetId: string },
  GenerationView[]
>;

/** Assignment: file an unattributed event under an Asset, clearing its flag. */
export const assignAssetRef = makeFunctionReference<'mutation'>(
  'events:assignAsset',
) as FunctionReference<
  'mutation',
  'public',
  { organizationId: string; eventId: string; assetId: string },
  string
>;

/**
 * The read-only Org → Brand → Asset selection catalog (issue #5). The gallery
 * reads it to list Assignment targets (collections); real entity CRUD is out of
 * scope. Same query the extension popup selects from.
 */
export const seedCatalogRef = makeFunctionReference<'query'>('seed:catalog') as FunctionReference<
  'query',
  'public',
  Record<string, never>,
  SeedCatalog
>;
