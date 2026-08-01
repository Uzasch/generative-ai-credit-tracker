# Token Tracker for AI Generation

Glossary for a browser extension + dashboard that tracks AI-generation credit
usage per user and per asset, rolled up to a brand, with refunds reconciled.
This file is a glossary only — no implementation details.

## Roll-up model

**Organization**:
The top-level tenant (the customer, e.g. a studio). Owns both Users and Brands;
every Generation event is scoped to exactly one Organization. All data isolation
is per-Organization.
_Avoid_: company, team, tenant, workspace.

**Brand**:
An IP owned by an Organization. Usage rolls up: Asset → Brand → Organization.
_Avoid_: account, client.

**Asset**:
A single creative deliverable (a song, video, or image) worked on under a
Brand. The same Asset can be worked on by multiple Users, and their usage
aggregates to it. Not the same as a tool-side "project".
_Avoid_: project, item.

**User**:
An editor who operates the AI tools in their own browser, belonging to an
Organization. Identified by our own extension login, independent of the shared
tool seat they happen to be logged into (e.g. a shared `aibusiness@` Higgsfield
account). The tool account is kept only as event metadata.
_Avoid_: account, member, editor (informal).

**Generation event**:
A single generate action that consumes credits/tokens, attributed to one User
and one Asset. The core recorded unit.
_Avoid_: transaction, usage record.

**Cost**:
The credits/tokens a Generation event consumes, as charged by the tool.
_Avoid_: price, tokens (when ambiguous), spend.

**Refund**:
A Cost later reversed by the tool (e.g. a rejected/failed generation). Netted
out of usage totals, never deleted — recorded as a state transition on the
original Generation event.
_Avoid_: reversal, credit-back, chargeback.

## Higgsfield tool terms

These mirror Higgsfield's API vocabulary; we adopt them as-is for the
Higgsfield adapter.

**Job set**:
The unit Higgsfield returns from a single generate call. Carries the `cost`
and groups one or more Jobs (one per requested image/video, `batch_size`).
This is the granularity a Higgsfield Generation event maps to.

**Job**:
An individual image/video within a Job set. Has its own id and a lifecycle
status (`queued → in_progress → completed`, or a failure status). The output
media URL appears on the Job when completed.

**Tool project**:
Higgsfield's own `project_id` on a generate response. In observed captures it
is constant and equals the workspace id — it does NOT identify an Asset. Kept
only as raw metadata.
_Avoid_: project (unqualified — collides with Asset).

## Detection & discovery

**Capture probe**:
The Phase-1 extension build that logs all `fnf-api-gw` traffic (raw
request/response) so the signals we don't yet understand (refunds, batch cost)
can be found. Precedes the structured Generation-event pipeline.

**Flagged anomaly**:
A generation-related observation the deterministic runtime could not classify,
recorded with its raw evidence instead of guessed. Known triggers: a Generate
click with no matching generate request, a cancelled request, an unknown Job
status, or a Cost that disagrees with the button. Input to the Discovery agent.
_Avoid_: error, unknown event.

**Discovery agent**:
An offline LangGraph agent (Python, outside the locked runtime stack) that
consumes Flagged anomalies plus raw logs, locates the responsible
request/pattern, and proposes new detection logic for the Higgsfield adapter.
It emits **code**, never live per-event verdicts — so it stays out of the
billing path.
_Avoid_: agent (unqualified), classifier, reconciler.

**Result media**:
The output image/video URL(s) a completed Job produces (Higgsfield
`results.raw.url`). Captured with the Generation event and shown in the
generation gallery alongside its prompt.
_Avoid_: output, asset (collides with Asset), file.

**Assignment**:
The act of attaching an Unattributed Generation event to an Asset, performed by
an editor in our frontend (the generation gallery). Resolves the
`needs-assignment` flag.
_Avoid_: tagging, labelling (informal), attribution (that's the general concept).
