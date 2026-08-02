import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Token Tracker for AI Generation',
    description: 'Tracks AI-generation credit usage per user and per asset.',
    // Least privilege (AGENTS.md §5). Every permission needs a reason.
    permissions: [
      'storage', // cache the current user/session locally
      // Durably decay the toolbar activity badge (#18): an MV3 worker can be
      // terminated between generations, so the badge's rolling-window clear is
      // driven by a browser alarm rather than an in-worker timer that would be lost.
      'alarms',
    ],
    // Scope hosts to the three tools only — never <all_urls>.
    // TODO: confirm exact production hosts from captured traffic.
    host_permissions: [
      'https://labs.google/*',
      'https://*.higgsfield.ai/*',
      'https://*.klingai.com/*',
      // Background service worker writes raw captures to our Convex deployment.
      'https://*.convex.cloud/*',
    ],
  },
});
