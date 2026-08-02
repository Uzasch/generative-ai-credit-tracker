import Link from 'next/link';

export default function Home() {
  return (
    <main className="mx-auto max-w-4xl space-y-4 p-8">
      <h1 className="text-2xl font-semibold">Token Tracker Dashboard</h1>
      <p className="text-muted-foreground">
        Company-wide roll-ups (brand → asset → user) render here. Connect the Convex client and read{' '}
        <code>events.usageByAsset</code> and related queries once the backend deployment is
        provisioned.
      </p>
      <p>
        <Link href="/gallery" className="font-medium underline underline-offset-4">
          Open the Generation Gallery →
        </Link>{' '}
        <span className="text-muted-foreground">
          — review generations and clear the <code>unattributed</code> intake tray.
        </span>
      </p>
    </main>
  );
}
