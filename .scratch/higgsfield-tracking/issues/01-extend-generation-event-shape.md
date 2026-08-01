# 01 — Extend the GenerationEvent shape

**What to build:** The shared domain type and the Convex schema carry the full
Phase-1 Generation event shape agreed in the spec, so every later ticket has the
fields it needs. This is a prefactor — no runtime behaviour changes and the
existing roll-up query still works.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] `@token-tracker/shared` `GenerationEvent` gains `organizationId`,
      `assetId: string | 'unattributed'`, `prompt?`, `jobs: JobOutcome[]`,
      `toolAccount?`, and `ruleVersion`; `RefundState` is unchanged.
- [ ] A `JobOutcome` type exists: `jobId`, `status` (`queued | in_progress |
      completed | failed`), `mediaUrl?`.
- [ ] The Convex schema mirrors the shape with validators and adds a `by_org`
      (and `by_org_brand`) index; `@token-tracker/shared` stays the single source
      of truth (no re-declared shapes).
- [ ] `pnpm typecheck` and `pnpm check` pass across workspaces; the existing
      `usageByAsset` query still compiles.
