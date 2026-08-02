import type { SeedCatalog } from '@token-tracker/shared';
import { type FunctionReference, makeFunctionReference } from 'convex/server';

/**
 * Typed reference to the Convex `seed:catalog` query. Referenced by name — like
 * the mutations in `lib/convex.ts` — so the extension bundle never imports the
 * convex package's generated `api`. The type parameters carry the arg and return
 * shapes from the single source of truth (`@token-tracker/shared`).
 */
export const seedCatalogRef = makeFunctionReference<'query'>('seed:catalog') as FunctionReference<
  'query',
  'public',
  Record<string, never>,
  SeedCatalog
>;
