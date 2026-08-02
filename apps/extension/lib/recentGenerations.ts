import type { RecentGenerationView } from '@token-tracker/shared';
import { type FunctionReference, makeFunctionReference } from 'convex/server';

/**
 * Typed reference to the Convex `events:recentGenerations` query (issue #18).
 * Referenced by name — like `seedCatalogRef` and the mutations in `lib/convex.ts`
 * — so the extension bundle never imports the convex package's generated `api`.
 * The arg and return shapes come from the single source of truth
 * (`@token-tracker/shared`), so this reference can't drift from the query.
 *
 * Org- AND user-scoped (ADR-0004): the popup passes the editor's Active
 * organization and login, and only ever gets that editor's own generations back.
 */
export type RecentGenerationsArgs = {
  organizationId: string;
  userId: string;
  limit?: number;
};

export const recentGenerationsRef = makeFunctionReference<'query'>(
  'events:recentGenerations',
) as FunctionReference<'query', 'public', RecentGenerationsArgs, RecentGenerationView[]>;
