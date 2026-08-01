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
    ],
    // Scope hosts to the three tools only — never <all_urls>.
    // TODO: confirm exact production hosts from captured traffic.
    host_permissions: [
      'https://labs.google/*',
      'https://*.higgsfield.ai/*',
      'https://*.klingai.com/*',
    ],
  },
});
