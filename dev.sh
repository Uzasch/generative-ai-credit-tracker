#!/usr/bin/env bash
#
# One command to (re)start the whole stack: kills any running dev processes,
# cleans build caches, reinstalls, then launches Convex + extension + dashboard
# together. Ctrl-C stops all three.
#
#   ./dev.sh
#
set -uo pipefail
cd "$(dirname "$0")"

echo "▸ stopping any running dev processes…"
pkill -f "convex dev"       2>/dev/null || true   # Convex backend
pkill -f "wxt"              2>/dev/null || true   # extension (WXT dev server)
pkill -f "next dev"         2>/dev/null || true   # dashboard (Next.js)
pkill -f "next-server"      2>/dev/null || true
# Free the dev ports (3000 = WXT dev server, 3001 = dashboard)
for port in 3000 3001; do
  pids=$(lsof -ti "tcp:${port}" 2>/dev/null || true)
  [ -n "${pids}" ] && kill -9 ${pids} 2>/dev/null || true
done

echo "▸ rebuilding (clean caches)…"
rm -rf apps/extension/.output apps/extension/.wxt apps/dashboard/.next

echo "▸ installing deps…"
pnpm install

echo "▸ starting Convex + extension + dashboard (Ctrl-C stops all)…"
echo "   • dashboard → http://localhost:3001/gallery"
echo "   • extension → apps/extension/.output/chrome-mv3 (WXT opens/reloads Chrome)"
exec pnpm dev
