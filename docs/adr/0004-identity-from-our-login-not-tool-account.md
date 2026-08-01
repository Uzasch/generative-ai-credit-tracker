# Editor identity comes from our own login, not the tool account

`userId` is established by the editor signing into **our extension** (Convex
auth), not read from the AI tool's account. The captured Higgsfield seat is a
**shared** business login (e.g. a shared `aibusiness@…` seat), so the tool's `user_id`
cannot distinguish the editors sharing it — using it would collapse every
editor into one user and destroy per-user attribution, which is a core product
axis. The tool account is still captured, but only as event **metadata**
(`toolAccount`) for cross-checking.

## Consequences

- A future reader must not "simplify" this by reading identity from `/fnf/user`
  — that path is deliberately rejected.
- A person who works for two Organizations has two logins; identity is strictly
  scoped to one Organization (single-tenant isolation).
