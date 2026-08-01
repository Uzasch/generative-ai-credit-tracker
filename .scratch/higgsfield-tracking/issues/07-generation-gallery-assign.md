# 07 — Generation gallery + assign unattributed

**What to build:** An editor can see the generations they've produced — with
prompt, output media, and cost — both as their own feed and per Asset. Stray
`unattributed` generations show flagged and can be assigned to an Asset from the
gallery, after which they roll up correctly.

**Blocked by:** 04, 05

**Status:** ready-for-agent

- [ ] Convex gallery queries return an editor's generations and a given Asset's
      generations (prompt + result media + cost), scoped by `organizationId`.
- [ ] The popup renders the gallery: the editor's own generations and the
      current Asset's generations, each showing prompt, output image/video, and
      cost.
- [ ] `unattributed` generations appear flagged with an **assign to Asset**
      action; an `assignAsset` mutation moves the event from `unattributed` to
      the chosen Asset and clears the `needs-assignment` flag.
- [ ] After assignment the generation appears under its Asset and rolls up to
      that Brand/Org.
- [ ] Demo: view the gallery; assign an unattributed generation and watch it
      move under its Asset.
