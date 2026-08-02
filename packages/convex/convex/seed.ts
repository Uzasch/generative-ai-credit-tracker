import type { SeedCatalog } from '@token-tracker/shared';
import { query } from './_generated/server';
import { CATALOG } from './catalog';

/**
 * The hardcoded Org → Brand → Asset + login catalog the popup selects from.
 * Read-only and args-free: it reads no tables and never writes. The catalog data
 * (and the Asset→Brand resolver `assignAsset` shares) lives in the pure
 * `catalog.ts` module so it is reused without a `_generated` dependency.
 */
export const catalog = query({
  args: {},
  handler: async (): Promise<SeedCatalog> => CATALOG,
});
