# Bound raw_captures growth: retention TTL + status-poll de-dup + noise denylist

ADR-0001 has the Phase-1 probe capture **all** `fnf-api-gw.higgsfield.ai`
traffic so unknown signals (refunds, batch cost) stay discoverable — that breadth
is what surfaced the `nsfw`/refund signal. But the table is append-mostly with no
retention, and a real cinema-studio session measured **62 rows of which only ~8
(~13%) were generation-related**; the other ~87% was UI chatter (`/fnf/folders`
alone was 21 rows / ~22 KB). Left alone this accumulates forever, ~87% noise.

We keep ADR-0001's "capture broadly to discover" intent but bound the table with
three measures, enforced at a **single write boundary** (the Convex
`rawCaptures.record` mutation) plus one scheduled prune. The rules are pure and
live in `@token-tracker/shared` so they are unit-tested and checkable from a diff.

## The rules (checkable)

1. **Retention TTL.** A daily cron (`crons.ts` → `internal.rawCaptures.pruneOld`)
   deletes rows with `capturedAt < now − 30 days`. The window is a single
   constant (`RAW_CAPTURE_TTL_MS`); the prune deletes in bounded batches and
   reschedules itself so a backlog never exceeds a transaction's write limit.
   *Check:* a row older than the TTL is gone after a prune; a newer row remains.

2. **Status-poll de-dup.** `record` does not insert a capture that is
   byte-identical (method, url, status, request body, response body — everything
   but capture time) to the **most recent prior capture for the same URL**. The
   tool re-polls `GET /fnf/jobs/{id}` and `POST /fnf/jobs/status-batch` until a
   job transitions, so a status *change* always differs and is always retained;
   only informationless repeats are dropped. General by construction: identical
   content is zero new information, and a real generate call is never a duplicate
   (its response carries a fresh job-set id).
   *Check:* two identical consecutive polls ⇒ one row; a transition ⇒ a new row.

3. **Noise denylist.** `record` does not store a URL whose pathname is known
   non-generation chatter (`isDenylistedCaptureUrl`). Denied prefixes:
   `/fnf/folders`, `/fnf/tours`, `/fnf/banner`, `/fnf/referral-campaigns`,
   `/fnf/feedback`, `/fnf/color-presets`, `/fnf-notification/`,
   `/fnf/workspaces`, plus the per-model shape `/fnf/{model}/presets/…`.
   **Kept** (not denied): `/fnf/jobs*` (generation), `/fnf/user` (identity), and
   `/fnf/workspaces/wallet*` (the refund/wallet cross-check, #17) — carved out
   from the `/fnf/workspaces` prefix. Anything unrecognised is kept: the denylist
   only removes traffic positively identified as noise, so ADR-0001's breadth
   stays the default for signals we haven't seen yet.
   *Check:* a denylisted path is not stored; `/fnf/jobs*`, `/fnf/user`, and
   `/fnf/workspaces/wallet` still are.

## Consequences

- This narrows ADR-0001's "capture all" — a deliberate, recorded scope change,
  not a silent one. Breadth is preserved where discovery value lives: all
  unrecognised endpoints, all `/fnf/jobs*`, recent traffic within the TTL. What
  we drop is either positively-identified noise or informationless poll repeats,
  so no unknown signal (refund, batch cost) is put out of reach.
- Enforcement is **not** by mutating rows: ADR-0001/ADR-0003 replayability holds
  because a stored row is still never patched or deleted-in-place except by the
  TTL prune, which removes whole aged rows rather than editing them.
- One boundary, one shared rule set. The extension keeps observing broadly and
  posting every capture (ADR-0001's least-surface probe is unchanged); Convex —
  the data source of truth — decides retention. A future client can't smuggle
  noise past the denylist, and the de-dup can't be bypassed client-side.
- Projected re-measure of the cinema-studio session: the denylist removes the
  `/fnf/folders`/tours/notifications/banner/referral/presets/workspaces rows (the
  bulk of the 54 noise rows), de-dup collapses the 6 job-status polls for 2 jobs
  to their distinct transitions, and the TTL bounds the long tail — taking stored
  rows from 62 toward the ~8 generation-related (plus retained `/fnf/user` and
  wallet cross-check rows).

## Considered and rejected

- **Filtering in the extension probe instead of Convex.** Rejected as the
  primary boundary: the acceptance is about what is *stored*, de-dup needs the
  prior row (server state) anyway, and a single authoritative gate can't be
  outrun by a stale client. The probe stays deliberately dumb (ADR-0001).
- **Retention by shrinking/truncating row bodies.** Rejected: verbatim bodies are
  what make discovery and rule-replay possible (ADR-0003). We drop whole
  low-value rows, never edit retained ones.
- **De-dup scoped to only the two known status-poll URL shapes.** Rejected in
  favour of the general identical-content rule: it needs no Higgsfield URL-shape
  knowledge in the retention layer, and identical content is by definition safe
  to drop regardless of endpoint.
- **A shorter/aggressive TTL (e.g. 7 days).** Deferred: 30 days keeps a
  comfortable discovery window; the window is one constant to revisit once the
  refund/batch signals are fully understood.
