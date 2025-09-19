import json, os, datetime

# Inputs from env (with fallbacks)
commit  = os.environ.get("COMMIT_SHA","").strip()
prod    = os.environ.get("PRODUCT_TIME","")    # satellite product time, ISO
gen     = os.environ.get("GENERATED_UTC","")   # render time, ISO

owner   = os.environ.get("GH_OWNER","Bryan701701")
repo    = os.environ.get("GH_REPO","spoton-synoptic")

png_path   = "synoptic/atlantic_focus.png"
areas_path = "synoptic/atlantic_focus_areas.json"
sf_path    = "synoptic/shipping_forecast_latest.json"

if not gen:
    gen = datetime.datetime.utcnow().replace(microsecond=0).isoformat()+"Z"

def mk_url(path):
    return f"https://raw.githubusercontent.com/{owner}/{repo}/{commit}/{path}" if commit else None

sidecar = {
    "status": "ok",
    "product_time": prod or None,
    "generated_utc": gen,
    "commit": commit or None,
    "png_url": mk_url(png_path),
    "areas_url": mk_url(areas_path),
    "sf_url": mk_url(sf_path),
}

out = "synoptic/atlantic_focus.png.json"
with open(out, "w", encoding="utf-8") as f:
    json.dump(sidecar, f, indent=2)
print(f"Wrote {out}")
