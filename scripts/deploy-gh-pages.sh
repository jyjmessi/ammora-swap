#!/usr/bin/env bash
# Builds the app and publishes dist/ to the gh-pages branch that GitHub Pages serves.
# Usage: ./scripts/deploy-gh-pages.sh
set -euo pipefail

cd "$(dirname "$0")/.."
npm run build

REMOTE="$(git remote get-url origin)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cp -r dist/. "$TMP/"
touch "$TMP/.nojekyll"

cd "$TMP"
git init -q -b gh-pages
git add -A
git -c user.name="github-actions" -c user.email="github-actions@users.noreply.github.com" commit -q -m "Deploy Ammora Swap"
git push -f "$REMOTE" gh-pages
echo "published to gh-pages"
