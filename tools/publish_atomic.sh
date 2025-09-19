#!/usr/bin/env bash
set -euo pipefail

# Inputs (pass these if you have them; otherwise we’ll fallback)
PRODUCT_TIME="${PRODUCT_TIME:-}"    # e.g. 2025-09-19T08:20:00Z from your sat job
GENERATED_UTC="${GENERATED_UTC:-}"  # when your renderer ran; defaults to now

# Ensure the three payloads exist in synoptic/
for f in synoptic/atlantic_focus.png synoptic/atlantic_focus_areas.json synoptic/shipping_forecast_latest.json; do
  if [[ ! -f "$f" ]]; then
    echo "ERROR: missing $f" >&2
    exit 1
  fi
done

# 1) Stage payloads and make an initial commit
git add synoptic/atlantic_focus.png synoptic/atlantic_focus_areas.json synoptic/shipping_forecast_latest.json
git commit -m "Synoptic atomic: PNG + areas + SF"

# 2) Capture the commit SHA
COMMIT_SHA="$(git rev-parse HEAD)"

# 3) Generate the sidecar that points sf_url to THIS commit’s JSON
export COMMIT_SHA
export PRODUCT_TIME
export GENERATED_UTC
export GH_OWNER="${GH_OWNER:-Bryan701701}"
export GH_REPO="${GH_REPO:-spoton-synoptic}"
export SF_PATH="synoptic/shipping_forecast_latest.json"

python3 tools/gen_sidecar.py

# 4) Add sidecar and amend the same commit (atomic)
git add synoptic/atlantic_focus.png.json
git commit --amend --no-edit

echo "Amended commit: $(git rev-parse HEAD)"
echo "Done. Now push your branch."
