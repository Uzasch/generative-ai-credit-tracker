# 02 — Capture probe: retain raw fnf-api-gw traffic

**What to build:** The extension observes and retains all Higgsfield API traffic
so the signals we don't yet understand (refunds, batch cost) can be discovered
later and every derived number is replayable (ADR-0001, ADR-0003). Observe-only:
it never blocks, delays, or modifies a request.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [x] The MAIN-world fetch patch is scoped to `fnf-api-gw.higgsfield.ai` only;
      `clerk` / `kopir` / `cms` / `sentry` hosts are never captured.
- [x] The patch captures request method + body (POST generate calls included —
      it currently hardcodes GET) and the response body; request headers are
      dropped entirely.
- [x] Each capture is appended to an append-only `raw_captures` Convex table
      (method, url, request body, response body, timestamp).
- [ ] Using Higgsfield fills `raw_captures`, and no auth token or request header
      ever appears in the stored rows. — no-header/no-token guaranteed by design
      (headers are never read); the live "fills `raw_captures`" pass is pending a
      manual run of the loaded extension against Higgsfield.
- [x] The page's own fetch behaviour is unchanged (body cloned, not consumed).
