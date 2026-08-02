import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { loadActiveContext, saveActiveContext } from '@/lib/activeContext';
import { seedCatalogRef } from '@/lib/seed';
import type { ActiveContext } from '@token-tracker/shared';
import { useQuery } from 'convex/react';
import { type ReactNode, useEffect, useState } from 'react';

/**
 * Radix `Select` forbids an empty-string item value (it reserves `''` for the
 * cleared/placeholder state), so the Active-Asset picker's "None" choice carries
 * this sentinel instead. It maps to a `null` `assetId` — the unattributed state.
 */
const NO_ASSET_VALUE = '__none__';

/**
 * Popup: the editor's minimal "our login" identity and the Org → Brand → Active
 * Asset picker (issue #5). Selections are persisted as the {@link ActiveContext}
 * the background stamps onto every captured generation (ADR-0004). The current
 * Active Asset is shown prominently so work is never attributed to yesterday's
 * Asset; with none selected, generations are recorded `unattributed`.
 *
 * The seed catalog is served read-only by Convex (`seed:catalog`); real Org /
 * Brand / Asset / User CRUD is out of scope for this ticket. The pickers use the
 * shadcn `Select` and the Clear action the shadcn `Button` (AGENTS.md §7) — both
 * labelled and keyboard-navigable, over theme tokens (light/dark).
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
          value={organizationId ?? undefined}
          onValueChange={selectOrg}
        >
          {catalog.orgs.map((o) => (
            <SelectItem key={o.organizationId} value={o.organizationId}>
              {o.name}
            </SelectItem>
          ))}
        </SelectField>

        <SelectField
          id="user"
          label="Editor (our login for this Org)"
          value={userId ?? undefined}
          onValueChange={setUserId}
          disabled={!org}
        >
          {org?.users.map((u) => (
            <SelectItem key={u.userId} value={u.userId}>
              {u.displayName}
            </SelectItem>
          ))}
        </SelectField>

        <SelectField
          id="brand"
          label="Brand"
          value={brandId ?? undefined}
          onValueChange={selectBrand}
          disabled={!org}
        >
          {org?.brands.map((b) => (
            <SelectItem key={b.brandId} value={b.brandId}>
              {b.name}
            </SelectItem>
          ))}
        </SelectField>

        <SelectField
          id="asset"
          label="Active Asset"
          // The "None" sentinel stands in for a null assetId (Radix bans '').
          value={assetId ?? NO_ASSET_VALUE}
          onValueChange={(v) => setAssetId(v === NO_ASSET_VALUE ? null : v)}
          disabled={!brand}
        >
          <SelectItem value={NO_ASSET_VALUE}>— None (unattributed) —</SelectItem>
          {brand?.assets.map((a) => (
            <SelectItem key={a.assetId} value={a.assetId}>
              {a.name}
            </SelectItem>
          ))}
        </SelectField>

        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0 text-muted-foreground"
          onClick={() => setAssetId(null)}
          disabled={assetId === null}
        >
          Clear Active Asset
        </Button>
      </div>
    </main>
  );
}

/**
 * A labelled shadcn `Select` — the `<label>`'s `htmlFor` targets the trigger's
 * `id`, keeping the control labelled and keyboard-navigable (AGENTS.md §7).
 * `onValueChange` hands back the selected item's value; the caller maps it (e.g.
 * the Active-Asset "None" sentinel ⇒ no Active Asset). A `undefined` value shows
 * the `placeholder`.
 */
function SelectField({
  id,
  label,
  value,
  onValueChange,
  placeholder,
  disabled,
  children,
}: {
  id: string;
  label: string;
  value: string | undefined;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-medium">
        {label}
      </label>
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger id={id}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </div>
  );
}
