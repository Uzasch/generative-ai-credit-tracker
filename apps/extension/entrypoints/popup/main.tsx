import { ConvexProvider, ConvexReactClient } from 'convex/react';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './style.css';

const root = document.getElementById('root');
if (!root) throw new Error('popup root element missing');

// Public deployment endpoint, injected at build time — never a secret (AGENTS.md §5).
const CONVEX_URL = import.meta.env.VITE_CONVEX_URL as string | undefined;
const convex = CONVEX_URL ? new ConvexReactClient(CONVEX_URL) : null;

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    {convex ? (
      <ConvexProvider client={convex}>
        <App />
      </ConvexProvider>
    ) : (
      <main className="p-4 space-y-2">
        <h1 className="text-base font-semibold">Token Tracker</h1>
        <p className="text-sm text-destructive">
          <code>VITE_CONVEX_URL</code> is not set — run the Convex dev deployment and rebuild the
          extension to pick your Active Asset.
        </p>
      </main>
    )}
  </React.StrictMode>,
);
