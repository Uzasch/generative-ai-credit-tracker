export default function Home() {
  return (
    <main className="mx-auto max-w-4xl p-8 space-y-4">
      <h1 className="text-2xl font-semibold">Token Tracker Dashboard</h1>
      <p className="text-muted-foreground">
        Company-wide roll-ups (brand → asset → user) render here. Connect the Convex client and read{' '}
        <code>events.usageByAsset</code> and related queries once the backend deployment is
        provisioned.
      </p>
    </main>
  );
}
