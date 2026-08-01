# 06 — Net usage roll-ups (asset → brand → org, and per-user)

**What to build:** Usage totals that net out refunds, along both roll-up axes.
This is the third confirmed test seam and is independent of the capture pipeline,
so it can proceed in parallel.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Convex queries compute net usage (Cost charged − refunded amount) for an
      Asset, a Brand, an Organization, and independently per User, all filtered
      by `organizationId`.
- [ ] `unattributed` events roll up to their Brand/Org but to no Asset.
- [ ] `convex-test` coverage: net = charges − refunds; a refunded event reduces
      the total; an unattributed event is excluded from any Asset total but
      included at Brand/Org level.
- [ ] Demo: totals are queryable per asset / brand / org / user and reconcile
      against the underlying events.
