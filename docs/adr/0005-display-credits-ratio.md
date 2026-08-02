# Displayed credits = internal cost ÷ 100

Higgsfield tracks two representations of the same money: an **internal cost unit**
(integer) and a **user-facing "credit"** (two-decimal). The user-facing figure is
the internal unit **divided by 100**. We store the internal unit as captured and
compute the displayed figure as `internal / 100`, rounded to two decimals, at the
presentation layer only. We do **not** scrape the rendered UI to obtain it.

## Evidence

From captured `raw_captures` traffic (issue #2), the same balances appear in both
units in the same session:

| Quantity | `/fnf/user` (displayed) | `/fnf/workspaces/wallet` (internal) | ratio |
|---|---|---|---|
| subscription | `subscription_credits` = 447.14 | `subscription_balance` = 44714 | ×100 |
| package / main | `package_credits` = 2355.24 | `credits_balance` = 235524 | ×100 |

And a real generation (`POST /fnf/jobs/v2/nano_banana_2_lite`) returned
`job_sets[].cost = 100`, which the generate button rendered as **"1 credit"**
(100 ÷ 100 = 1.00). The `/fnf/job-sets/costs` price table and `/fnf/jobs/accessible`
history express costs in the same internal unit.

## Consequences

- `GenerationEvent.cost` stores the **internal** unit exactly as captured
  (`job_sets[].cost`), with no conversion at write time — history stays faithful
  to the source and replayable (ADR-0001, ADR-0003).
- Any user-facing credit number (popup, dashboard) is derived: `internal / 100`,
  two-decimal rounding. This is a single pure display helper, not scattered math.
- We do **not** need DOM capture to show a correct credit figure; the network
  capture already contains everything required.

## Risks and cross-check

- The ÷100 ratio is assumed **constant across models and currencies**. It is
  confirmed for image (`nano_banana_2_lite`) and the wallet/user endpoints; video
  per-second costs (`/fnf/job-sets/costs`) use the same unit, but not every model
  has been observed.
- If a model ever violates ÷100, a silent display error results. Issue #13 adds an
  optional DOM cross-check that reads the rendered button label and flags any case
  where `displayedCost * 100 != job_sets[].cost`. That ticket is the guardrail for
  this ADR, not a replacement for it.

## Considered and rejected

- **Scrape the button label as the source of truth.** Rejected: the rendered value
  is prospective (shown before the click), brittle against a React app with hashed
  class names, and must still be correlated to the network event. It is a
  cross-check (issue #13), not the primary source.
- **Convert to displayed credits at write time.** Rejected: it discards the exact
  captured number and makes a wrong ratio permanent instead of recomputable.
