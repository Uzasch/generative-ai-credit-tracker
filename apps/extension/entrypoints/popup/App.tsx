export function App() {
  return (
    <main className="p-4 space-y-2">
      <h1 className="text-base font-semibold">Token Tracker</h1>
      <p className="text-sm text-muted-foreground">
        Per-asset usage will appear here. Wire this to the Convex <code>events.usageByAsset</code>{' '}
        query once user/asset attribution is resolved.
      </p>
    </main>
  );
}
