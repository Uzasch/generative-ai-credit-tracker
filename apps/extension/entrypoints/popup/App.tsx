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
 * Brand / Asset / User CRUD is out of scope for this ticket. The pickers are
 * native labelled controls (accessible by default, AGENTS.md §7); adopting the
 * shadcn `Select`/`Button` components is deferred until that component library
 * is set up in the extension.
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

  // Once the catalog is loaded and nothing was restored, default the Org and —
  // since identity is org-scoped (ADR-0004) — its first login and first Brand,
  // but never an Active Asset, so a generation made before the editor picks one
  // is recorded unattributed.
  useEffect(() => {
    if (!hydrated || !catalog || organizationId !== null) return;
    const firstOrg = catalog.orgs[0];
    if (!firstOrg) return;
    setOrganizationId(firstOrg.organizationId);
    setUserId(firstOrg.users[0]?.userId ?? null);
    setBrandId(firstOrg.brands[0]?.brandId ?? null);
  }, [hydrated, catalog, organizationId]);

  const org = catalog?.orgs.find((o) => o.organizationId === organizationId) ?? null;
  const brand = org?.brands.find((b) => b.brandId === brandId) ?? null;
  const asset = brand?.assets.find((a) => a.assetId === assetId) ?? null;

  // Persist the Active context on every change once identity + Org + Brand exist.
  // The tool seat is captured from tool traffic (ADR-0004), not stored here.
  useEffect(() => {
    if (!hydrated || !userId || !organizationId || !brandId) return;
    const ctx: ActiveContext = { organizationId, userId, brandId, assetId };
    void saveActiveContext(ctx);
  }, [hydrated, userId, organizationId, brandId, assetId]);

  if (catalog === undefined) {
    return (
      <main className="p-4">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </main>
    );
  }

  function selectOrg(nextOrgId: string) {
    const nextOrg = catalog?.orgs.find((o) => o.organizationId === nextOrgId) ?? null;
    setOrganizationId(nextOrgId);
    // Identity is strictly org-scoped (ADR-0004): re-establish the login from the
    // new Org's own roster rather than carrying the previous Org's editor across.
    setUserId(nextOrg?.users[0]?.userId ?? null);
    setBrandId(nextOrg?.brands[0]?.brandId ?? null);
    setAssetId(null); // switching Org invalidates the Active Asset.
  }

  function selectBrand(nextBrandId: string) {
    setBrandId(nextBrandId);
    setAssetId(null); // switching Brand invalidates the Active Asset.
  }

  return (
    <main className="w-72 space-y-4 p-4">
      <header className="space-y-1">
        <h1 className="text-base font-semibold">Token Tracker</h1>
        <p className="text-xs text-muted-foreground">
          Generations are attributed to you and your Active Asset.
        </p>
      </header>

      {/* Prominent Active Asset banner — a heavy solid border + emphasis when set,
          a dashed muted outline when not. */}
      <section
        aria-label="Active Asset"
        className={`rounded-md border-2 p-3 ${
          asset ? 'border-primary bg-primary/10' : 'border-dashed border-muted-foreground/40'
        }`}
      >
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Active Asset</p>
        {asset ? (
          <p className="text-sm font-semibold text-foreground">{asset.name}</p>
        ) : (
          <p className="text-sm font-medium text-muted-foreground">
            None — generations will be recorded <span className="font-semibold">unattributed</span>{' '}
            and flagged for assignment.
          </p>
        )}
      </section>

      <div className="space-y-3">
        <SelectField
          id="org"
          label="Organization"
          value={organizationId ?? ''}
          onChange={selectOrg}
        >
          {catalog.orgs.map((o) => (
            <option key={o.organizationId} value={o.organizationId}>
              {o.name}
            </option>
          ))}
        </SelectField>

        <SelectField
          id="user"
          label="Editor (our login for this Org)"
          value={userId ?? ''}
          onChange={(v) => setUserId(v || null)}
          disabled={!org}
        >
          {org?.users.map((u) => (
            <option key={u.userId} value={u.userId}>
              {u.displayName}
            </option>
          ))}
        </SelectField>

        <SelectField
          id="brand"
          label="Brand"
          value={brandId ?? ''}
          onChange={selectBrand}
          disabled={!org}
        >
          {org?.brands.map((b) => (
            <option key={b.brandId} value={b.brandId}>
              {b.name}
            </option>
          ))}
        </SelectField>

        <SelectField
          id="asset"
          label="Active Asset"
          value={assetId ?? ''}
          onChange={(v) => setAssetId(v || null)}
          disabled={!brand}
        >
          <option value="">— None (unattributed) —</option>
          {brand?.assets.map((a) => (
            <option key={a.assetId} value={a.assetId}>
              {a.name}
            </option>
          ))}
        </SelectField>

        <button
          type="button"
          className="text-xs text-muted-foreground underline disabled:no-underline disabled:opacity-50"
          onClick={() => setAssetId(null)}
          disabled={assetId === null}
        >
          Clear Active Asset
        </button>
      </div>
    </main>
  );
}

/**
 * A labelled native `<select>` — labelled and keyboard-navigable by default
 * (AGENTS.md §7). `onChange` hands back the raw selected value; the caller maps
 * it (e.g. the empty string ⇒ no Active Asset).
 */
function SelectField({
  id,
  label,
  value,
  onChange,
  disabled,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-medium">
        {label}
      </label>
      <select
        id={id}
        className="w-full rounded border border-input bg-background p-1.5 text-sm disabled:opacity-50"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        {children}
      </select>
    </div>
  );
}
