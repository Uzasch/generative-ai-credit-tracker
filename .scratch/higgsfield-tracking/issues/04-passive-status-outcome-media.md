# 04 — Passive status → outcome + result media

**What to build:** A recorded generation fills in its outcome and output links as
it finishes, by passively reading Higgsfield's own status polls (the extension
issues no Higgsfield requests of its own — ADR: passive observation).

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] `higgsfieldAdapter.extract()` also recognises status responses
      (`GET /fnf/jobs/{id}` and `POST /fnf/jobs/status-batch`) and produces Job
      outcome updates (status + `results.raw.url` media on completion).
- [ ] Background correlates an update to its originating event by `toolRef` /
      job id and patches the matching `JobOutcome` in `jobs[]`.
- [ ] A Job transitions `queued → in_progress → completed`, and its `mediaUrl`
      is attached when completed.
- [ ] Fixture tests cover a status response producing an outcome update, and a
      `status-batch` response.
- [ ] Demo: after generating, the event's job(s) reach `completed` with a
      working media link.
