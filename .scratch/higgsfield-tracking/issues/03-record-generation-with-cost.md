# 03 — Record a Higgsfield generation with the correct cost

**What to build:** A real Higgsfield generate action becomes a recorded
Generation event carrying the exact credits charged. One event = one Job set
(the generate response), with its child jobs and prompt. Attribution is stubbed
to a fixed context here — real attribution arrives in ticket 05.

**Blocked by:** 01, 02

**Status:** ready-for-agent

- [ ] `higgsfieldAdapter.extract()` recognises the generate response
      (`POST /fnf/jobs/{type}` and `/fnf/jobs/v2/{type}`) and returns cost,
      `toolRef` (job-set id), prompt, and the child job ids; it returns null for
      responses it doesn't care about (e.g. `/fnf/user`, `/tours`).
- [ ] Cost is read from the response `job_sets[].cost`: paid image ⇒ 100, free
      (`null`) ⇒ 0, video ⇒ 500 / 750 for the captured samples.
- [ ] Background records a `GenerationEvent` to Convex via the `record` mutation,
      stamped with a `ruleVersion` and a stubbed org/user/brand + `unattributed`
      asset.
- [ ] Fixture tests drive `extract()` from the real captured HARs in
      `input/higgsfield/` (secrets stripped), covering paid, free, and both video
      cases plus a non-matching response.
- [ ] Demo: generate on Higgsfield → exactly one event row appears with the
      correct cost and `toolRef`.
