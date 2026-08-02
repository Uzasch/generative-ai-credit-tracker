import type { ActiveContext } from '@token-tracker/shared';
import { storage } from 'wxt/storage';

/**
 * The editor's Active context — identity (from our own login, ADR-0004) plus the
 * Org / Brand / Active Asset chosen in the popup. The popup owns writes; the
 * background reads it when attributing a captured generation. Persisted in
 * `local` extension storage (the manifest's `storage` permission) so it survives
 * the popup closing and the service worker sleeping. `null` until the editor has
 * established one.
 */
const activeContextItem = storage.defineItem<ActiveContext | null>('local:activeContext', {
  fallback: null,
});

/** Read the current Active context, or `null` if the editor hasn't set one yet. */
export function loadActiveContext(): Promise<ActiveContext | null> {
  return activeContextItem.getValue();
}

/** Persist the editor's Active context (called by the popup on every change). */
export function saveActiveContext(ctx: ActiveContext): Promise<void> {
  return activeContextItem.setValue(ctx);
}

/** Subscribe to Active-context changes; returns an unsubscribe function. */
export function watchActiveContext(cb: (ctx: ActiveContext | null) => void): () => void {
  return activeContextItem.watch(cb);
}
