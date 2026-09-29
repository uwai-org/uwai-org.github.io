#!/usr/bin/env bash
# Publish the committed HEAD of this repo as the unlisted draft preview at
# https://wai-org.com/draft/ (GitHub Pages of uwai-org/draft, gh-pages branch).
#
# Builds from a clean export of HEAD, so uncommitted edits never reach the preview.
# Needs the same local toolchain as `jekyll serve` (bundle, pandoc, pandoc-sidenote.lua).
# Usage, from the repo root:  _scripts/deploy_draft.sh
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
SRC="$(mktemp -d)"
OUT="$(mktemp -d)"
trap 'rm -rf "$SRC" "$OUT"' EXIT

git archive HEAD | tar -x -C "$SRC"
JEKYLL_ENV=production bundle exec jekyll build \
  --source "$SRC" --destination "$OUT" --baseurl /draft \
  --config "$SRC/_config.yml,$SRC/_config.draft.yml"

rm -f "$OUT/CNAME"       # the preview must not claim the org's custom domain
touch "$OUT/.nojekyll"   # serve the prebuilt files as-is

REV="$(git rev-parse --short HEAD)"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
git -C "$OUT" init -q -b gh-pages
git -C "$OUT" add -A
git -C "$OUT" -c user.name="$(git config user.name)" -c user.email="$(git config user.email)" \
  commit -q -m "Draft preview of uwai-org.github.io@$REV ($BRANCH)"
git -C "$OUT" push -q -f https://github.com/uwai-org/draft.git gh-pages
echo "Pushed $BRANCH@$REV -> https://wai-org.com/draft/ (Pages takes about a minute to update)"
