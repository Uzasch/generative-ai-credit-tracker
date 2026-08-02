/**
 * Selection catalog for the popup's Org → Brand → Asset picker and minimal
 * login roster. These are *seed* shapes only: issue #5 keeps real Org / Brand /
 * Asset / User CRUD out of scope, so the catalog is hardcoded server-side and
 * read-only. When real entity management lands, these become the persisted
 * entity shapes (or are replaced by them) — defined here once so the extension
 * and the Convex seed never re-declare them.
 */

/** An editor selectable in the minimal "our login" roster (ADR-0004 identity). */
export type SeedUser = {
  userId: string;
  displayName: string;
};

/** A creative deliverable under a Brand. */
export type SeedAsset = {
  assetId: string;
  name: string;
};

/** An IP under an Organization, owning the Assets usage rolls up to. */
export type SeedBrand = {
  brandId: string;
  name: string;
  assets: SeedAsset[];
};

/** The tenant. Every generation is scoped to exactly one of these (ADR-0004). */
export type SeedOrg = {
  organizationId: string;
  name: string;
  /** Shared tool seat used under this org, stamped as event metadata (ADR-0004). */
  toolAccount?: string;
  brands: SeedBrand[];
};

/** The full hardcoded selection catalog returned by the Convex `seed:catalog` query. */
export type SeedCatalog = {
  users: SeedUser[];
  orgs: SeedOrg[];
};
