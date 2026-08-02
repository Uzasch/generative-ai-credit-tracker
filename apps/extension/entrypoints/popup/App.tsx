import { loadActiveContext, saveActiveContext } from '@/lib/activeContext';
import { seedCatalogRef } from '@/lib/seed';
import type { ActiveContext } from '@token-tracker/shared';
import { useQuery } from 'convex/react';
import { type ReactNode, useEffect, useState } from 'react';

/**
 * Popup: the editor's minimal "our login" identity and the Org → Brand → Active
 * Asset picker (issue #5). Selections are persisted as the {@link ActiveContext}
 * the background stamps onto every captured generation (ADR-0004). The current
 * Active Asset is shown prominently so work is never attributed to yesterday's
 * Asset; with none selected, generations are recorded `unattributed`.
 *
 * The seed catalog is served read-only by Convex (`seed:catalog`); real Org /
 * Brand / Asset / User CRUD is out of scope for this ticket.
 */
export function App() {
  const catalog = useQuery(seedCatalogRef);

  const [hydrated, setHydrated] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [brandId, setBrandId] = useState<string | null>(null);
  const [assetId, setAssetId] = useState<string | null>(null);

  // Restore a previously-saved Active context once, before defaults are applied.
  useEffect(() => {
    let cancelled = false;
    void loadActiveContext().then((ctx) => {
      if (cancelled) return;
      if (ctx) {
        setUserId(ctx.userId);
        setOrganizationId(ctx.organizationId);
        setBrandId(ctx.brandId);
        setAssetId(ctx.assetId);
      }
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Once the catalog is loaded and nothing was restored, default the login and
  // Org/Brand to the first seeded values — but never an Active Asset, so a
  // generation made before the editor picks one is recorded unattributed.
  useEffect(() => {
    if (!hydrated || !catalog) return;
    if (userId === null) setUserId(catalog.users[0]?.userId ?? null);
    if (organizationId === null) {
      const firstOrg = catalog.orgs[0];
      if (firstOrg) {
        setOrganizationId(firstOrg.organizationId);
        setBrandId(firstOrg.brands[0]?.brandId ?? null);
      }
    }
  }, [hydrated, catalog, userId, organizationId]);

  const org = catalog?.orgs.find((o) => o.organizationId === organizationId) ?? null;
  const brand = org?.brands.find((b) => b.brandId === brandId) ?? null;
  const asset = brand?.assets.find((a) => a.assetId === assetId) ?? null;

  // Persist the Active context on every change once identity + Org + Brand exist.
  useEffect(() => {
    if (!hydrated || !userId || !organizationId || !brandId) return;
    const ctx: ActiveContext = {
      organizationId,
      userId,
      brandId,
      assetId,
      toolAccount: org?.toolAccount,
    };
    void saveActiveContext(ctx);
  }, [hydrated, userId, organizationId, brandId, assetId, org?.toolAccount]);

  if (catalog === undefined) {
    return (
      <main className="p-4">
        <p className="text-sm text-gray-500">Loading…</p>
      </main>
    );
  }

  function selectOrg(nextOrgId: string) {
    const nextOrg = catalog?.orgs.find((o) => o.organizationId === nextOrgId) ?? null;
    setOrganizationId(nextOrgId);
    setBrandId(nextOrg?.brands[0]?.brandId ?? null);
    setAssetId(null); // switching Org invalidates the Active Asset.
  }

  function selectBrand(nextBrandId: string) {
    setBrandId(nextBrandId);
    setAssetId(null); // switching Brand invalidates the Active Asset.
  }

  return (
    <main className="p-4 space-y-4 w-72">
      <header className="space-y-1">
        <h1 className="text-base font-semibold">Token Tracker</h1>
        <p className="text-xs text-gray-500">
          Generations are attributed to you and your Active Asset.
        </p>
      </header>

      {/* Prominent Active Asset banner. */}
      <section
        aria-label="Active Asset"
        className={`rounded-md border-2 p-3 ${
          asset ? 'border-blue-500 bg-blue-50' : 'border-dashed border-gray-300 bg-gray-50'
        }`}
      >
        <p className="text-xs uppercase tracking-wide text-gray-500">Active Asset</p>
        {asset ? (
          <p className="text-sm font-semibold text-blue-900">{asset.name}</p>
        ) : (
          <p className="text-sm font-medium text-gray-600">
            None — generations will be recorded <span className="font-semibold">unattributed</span>{' '}
            and flagged for assignment.
          </p>
        )}
      </section>

      <div className="space-y-3">
        <Field id="user" label="Editor (our login)">
          <select
            id="user"
            className="w-full rounded border border-gray-300 bg-white p-1.5 text-sm"
            value={userId ?? ''}
            onChange={(e) => setUserId(e.target.value || null)}
          >
            {catalog.users.map((u) => (
              <option key={u.userId} value={u.userId}>
                {u.displayName}
              </option>
            ))}
          </select>
        </Field>

        <Field id="org" label="Organization">
          <select
            id="org"
            className="w-full rounded border border-gray-300 bg-white p-1.5 text-sm"
            value={organizationId ?? ''}
            onChange={(e) => selectOrg(e.target.value)}
          >
            {catalog.orgs.map((o) => (
              <option key={o.organizationId} value={o.organizationId}>
                {o.name}
              </option>
            ))}
          </select>
        </Field>

        <Field id="brand" label="Brand">
          <select
            id="brand"
            className="w-full rounded border border-gray-300 bg-white p-1.5 text-sm"
            value={brandId ?? ''}
            onChange={(e) => selectBrand(e.target.value)}
            disabled={!org}
          >
            {org?.brands.map((b) => (
              <option key={b.brandId} value={b.brandId}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>

        <Field id="asset" label="Active Asset">
          <select
            id="asset"
            className="w-full rounded border border-gray-300 bg-white p-1.5 text-sm"
            value={assetId ?? ''}
            onChange={(e) => setAssetId(e.target.value || null)}
            disabled={!brand}
          >
            <option value="">— None (unattributed) —</option>
            {brand?.assets.map((a) => (
              <option key={a.assetId} value={a.assetId}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>

        <button
          type="button"
          className="text-xs text-gray-500 underline disabled:no-underline disabled:opacity-50"
          onClick={() => setAssetId(null)}
          disabled={assetId === null}
        >
          Clear Active Asset
        </button>
      </div>
    </main>
  );
}

/** A labelled form control — labelled and keyboard-navigable by default (AGENTS.md §7). */
function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}
