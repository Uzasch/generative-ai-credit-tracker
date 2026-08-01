# 05 — Active Asset attribution + minimal editor identity

**What to build:** Generations are attributed to the real editor and the Asset
they're working on. The editor picks an Active Asset in the popup; each
generation is stamped with their identity and that Asset's Brand/Org. A
generation made with no Active Asset is recorded `unattributed` and flagged for
later assignment. Everything is scoped to one Organization (ADR-0004).

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] A hardcoded Convex seed provides orgs / brands / assets for selection
      (real Org/Brand/Asset CRUD stays out of scope).
- [ ] A minimal "our login" identity establishes `userId` in the browser,
      independent of the shared tool seat; the tool account is captured as
      `toolAccount` metadata only.
- [ ] The popup has an Org → Brand → Asset selector and prominently shows the
      current Active Asset.
- [ ] A pure `attribute(extracted, activeContext) → GenerationEvent |
      FlaggedAnomaly` function replaces ticket 03's stub: it stamps
      `organizationId/userId/brandId/assetId`; with no Active Asset it yields
      `assetId: 'unattributed'` + a `needs-assignment` flag.
- [ ] Unit tests on `attribute()`: with Active Asset ⇒ fully stamped event;
      without ⇒ unattributed + flag.
- [ ] Demo: pick an Asset and generate → event carries it; clear the Asset and
      generate → event is `unattributed` and flagged.
