#!/usr/bin/env bash
set -euo pipefail

# Inputs (optional, workflow can pass these)
PRODUCT_TIME="${PRODUCT_TIME:-}"     # e.g. 2025-09-19T08:20:00Z
GENERATED_UTC="${GENERATED_UTC:-}"   # defaults to now in gen_sidecar.py if empty

need_files=(
  synoptic/atlantic_focus.png
  synoptic/atlantic_focus_areas.json
  synoptic/shipping_forecast_latest.json
)

# 0) All must exist
for f in "${need_files[@]}"; do
  [[ -f "$f" ]] || { echo "ERROR: missing $f" >&2; exit 1; }
done

# 1) Stage (force) and ensure they are actually staged
git add -f "${need_files[@]}"
for p in "${need_files[@]}"; do
  git diff --cached --name-only | grep -qx "$p" \
    || { echo "ERROR: $p not staged" >&2; exit 1; }
done

# 2) Commit payloads
git commit -m "Synoptic atomic: PNG + areas + SF"

# 3) Generate sidecar pinned to THIS commit
COMMIT_SHA="$(git rev-parse HEAD)"
export COMMIT_SHA PRODUCT_TIME GENERATED_UTC
export GH_OWNER="${GH_OWNER:-Bryan701701}"
export GH_REPO="${GH_REPO:-spoton-synoptic}"
export SF_PATH="synoptic/shipping_forecast_latest.json"

python3 tools/gen_sidecar.py
[[ -f synoptic/atlantic_focus.png.json ]] || { echo "ERROR: sidecar not written" >&2; exit 1; }

# 4) Sanity-check pinned URLs resolve (must be 200) before amending
png_url="https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${COMMIT_SHA}/synoptic/atlantic_focus.png"
areas_url="https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${COMMIT_SHA}/synoptic/atlantic_focus_areas.json"
sf_url="https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${COMMIT_SHA}/synoptic/shipping_forecast_latest.json"

for u in "$png_url" "$areas_url" "$sf_url"; do
  code=$(curl -sI "$u" | head -n1 | awk '{print $2}')
  [[ "$code" == "200" ]] || { echo "ERROR: $u -> HTTP $code" >&2; exit 1; }
done

# 5) Amend the same commit to include the sidecar (atomic)
git add -f synoptic/atlantic_focus.png.json
git commit --amend --no-edit

echo "Amended commit: $(git rev-parse HEAD)"