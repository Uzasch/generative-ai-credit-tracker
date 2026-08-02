# Unattributed generations carry an explicit assignment-state flag on the event

A generation captured with no Active Asset is still recorded, with `assetId` set
to the reserved `'unattributed'` sentinel. In addition to that sentinel, every
`GenerationEvent` carries an explicit `assignment` field — a discriminated union
`{ status: 'assigned' } | { status: 'needs-assignment' }` — that mirrors the
sentinel: `'needs-assignment'` exactly when `assetId === 'unattributed'`, and
`'assigned'` otherwise. The pure `attribute()` function sets it, and the Convex
`events.record` mutation — the source-of-truth write boundary — derives it from
`assetId` and **rejects** any event whose `assignment` contradicts its `assetId`,
so a contradictory event can never be persisted. Resolving the flag is what
"Assignment" (CONTEXT.md) does: attaching the event to a real Asset flips both
`assetId` and `assignment` together.

This is distinct from a **Flagged anomaly** (CONTEXT.md), which is an observation
the runtime *could not classify* (no matching request, unknown Job status,
cost ≠ button) and is routed to the Discovery agent (ADR-0003). An unattributed
generation is a fully-understood, real event awaiting Assignment — never an
anomaly, and never input to Discovery.

## Consequences

- The needs-assignment state is a first-class, queryable fact on the event, not
  merely inferred from a magic string. The future generation gallery lists work
  needing assignment, and Assignment resolves a named flag rather than mutating a
  sentinel by convention.
- The state is modeled as a discriminated union, not a boolean-with-flag
  (AGENTS.md §4), and mirrors the existing `RefundState` idiom — one union field
  on the event, defaulted server-side.
- `assignment` and the `'unattributed'` `assetId` sentinel are deliberately
  redundant: they encode the same fact two ways. The redundancy is made safe by a
  single invariant enforced at exactly one place — the `events.record` mutation —
  so the two can never disagree in stored data. Any future writer (e.g. an
  Assignment mutation) must update both together and will be rejected otherwise.
- A real charge is never lost: an unattributed generation is recorded as an
  ordinary event that rolls up to its Brand and Organization (just not to any
  Asset), consistent with ADR-0004's single-Organization scoping.

## Considered and rejected

- **The `'unattributed'` sentinel alone, with no `assignment` field.** Rejected:
  the acceptance criteria call for an explicit needs-assignment flag, and an
  independent review flagged the sentinel-as-flag as implicit and unenforced at
  the write boundary. The sentinel stays (it is what the Asset roll-up refuses),
  but the explicit state makes the intent legible and enforceable.
- **A bare boolean `needsAssignment`.** Rejected by AGENTS.md §4 (model states as
  discriminated unions, not booleans-with-flags); the union also leaves room for
  additional statuses without a second boolean.
- **Modeling the unattributed case as a `FlaggedAnomaly`.** Rejected: it conflates
  two distinct glossary concepts and would risk routing a real, assignable event
  into the Discovery pipeline (ADR-0003) instead of Assignment.
- **Deriving `assignment` purely at read time, storing only the sentinel.**
  Rejected in favour of storing the derived value so the fact is queryable and
  indexable directly, while still deriving-and-validating at the single write
  boundary so it cannot drift from `assetId`.
