#!/bin/bash
# Dev build + yalc push — skips tsgo type errors (pre-existing), copies assets and extensions only.
# Usage: ./scripts/dev-push.sh
set -e
cd "$(dirname "$0")/.."

echo "==> Copying assets + extensions to dist/..."
npx shx mkdir -p dist/extensions
npx shx cp -r extensions/* dist/extensions/
npx shx rm -rf dist/extensions/**/__tests__ dist/extensions/**/*.test.ts

# Also copy core dist if tsgo hasn't run (for dev, bun loads .ts directly)
echo "==> yalc push..."
npx yalc push

echo "==> Done. Restart dev server + Agent sessions to load changes."
