import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

// Demo (issue #8): cancel a generation after clicking Generate → a
// `click-no-request` anomaly is recorded with its raw evidence and shows up in
// the org-scoped anomaly list — never billed, never visible to another tenant.
// The extension's click tripwire + background correlation decide *when* to raise
// it (covered by the ClickRequestCorrelator unit tests); this demo exercises the
// Convex persistence + org-scoped read the runtime writes into.
// Run with `pnpm --filter @token-tracker/convex test`.

const modules = import.meta.glob('./**/*.*s');
const ORG = 'org_studio';
const RIVAL = 'org_rival';

test('demo: a cancelled Generate click is recorded as a click-no-request anomaly', async () => {
  const t = convexTest(schema, modules);

  // The editor clicked Generate at t=1000 but cancelled before the request went
  // out, so no generate request followed within the 4s window. After the window
  // elapsed the background swept the unmatched click and recorded the anomaly.
  const clickedAt = 1000;
  const windowMs = 4000;
  await t.mutation(api.flaggedAnomalies.record, {
    organizationId: ORG,
    tool: 'higgsfield',
    observedAt: clickedAt,
    evidence: { kind: 'click-no-request', host: 'higgsfield.ai', clickedAt, windowMs },
  });

  // It surfaces in the owning org's anomaly list as raw evidence for the
  // Discovery agent (ADR-0003) — not as a billable event.
  const anomalies = await t.query(api.flaggedAnomalies.listByOrg, { organizationId: ORG });
  expect(anomalies).toHaveLength(1);
  const evidence = anomalies[0]?.evidence;
  expect(evidence?.kind).toBe('click-no-request');

  // A foreign org sees nothing — strict per-org isolation (ADR-0004).
  const foreign = await t.query(api.flaggedAnomalies.listByOrg, { organizationId: RIVAL });
  expect(foreign).toHaveLength(0);

  console.log(
    `\nClick-no-request demo (issue #8):
  org ${ORG}: clicked Generate at t=${clickedAt}, no request within ${windowMs}ms
    -> flagged anomaly kind=${evidence?.kind} (raw evidence, not billed)
  org ${RIVAL}: sees 0 anomalies (org-scoped, ADR-0004)
`,
  );
});
