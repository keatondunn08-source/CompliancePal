#!/usr/bin/env python3
"""Fetch the Overture Maps layers used by the flyover renders.

Reads the public Overture bucket on S3 directly. The STAC catalogue host is not
needed, so this works in locked-down CI/cloud environments that allow S3.

Usage:  python3 fetch_overture.py            # all layers, one box per area
        python3 fetch_overture.py building   # just one layer (run layers in parallel)
Output: .cache/overture/<layer>.geojson      (lon/lat, trimmed properties)
"""
import json
import sys
import time
from pathlib import Path

from overturemaps import core
from shapely import wkb
from shapely.geometry import mapping

HERE = Path(__file__).parent
RELEASE = "2026-09-23.1"
CONFIG = json.loads((HERE / "areas.json").read_text())


# The Northern Rivers areas are 20-50 km apart, so a single union box would be
# mostly farmland. Fetch one box per area instead: camera path plus the model
# extent (3.5 km), the build margin and the look-ahead offset.
def area_bbox(area, pad=0.05):
    (x0, y0), (x1, y1) = area["camera"]["path"]
    return (min(x0, x1) - pad, min(y0, y1) - pad, max(x0, x1) + pad, max(y0, y1) + pad)


REGION_BBOXES = [area_bbox(a) for a in CONFIG["areas"]]

OUT = HERE / ".cache" / "overture"

# layer name -> (overture type, properties to keep)
LAYERS = {
    "building": ("building", ["height", "num_floors", "min_height", "class", "is_underground"]),
    "segment": ("segment", ["subtype", "class"]),
    "water": ("water", ["subtype", "class"]),
    "land_use": ("land_use", ["subtype", "class"]),
    "land": ("land", ["subtype", "class"]),
}


def round_coords(obj, nd=6):
    if isinstance(obj, (list, tuple)):
        if obj and isinstance(obj[0], (int, float)):
            return [round(v, nd) for v in obj[:2]]
        return [round_coords(o, nd) for o in obj]
    return obj


def fetch(layer: str) -> None:
    otype, keep = LAYERS[layer]
    dest = OUT / f"{layer}.geojson"
    if dest.exists():
        print(f"[skip] {dest} exists")
        return
    t0 = time.time()
    features = []
    for bbox in REGION_BBOXES:
        reader = core.record_batch_reader(otype, bbox=bbox, release=RELEASE, stac=False)
        if reader is None:
            raise SystemExit(f"failed to open {otype}")
        for batch in reader:
            cols = batch.to_pydict()
            for i, geom in enumerate(cols["geometry"]):
                shape = wkb.loads(geom)
                if shape.is_empty:
                    continue
                props = {k: cols[k][i] for k in keep if k in cols}
                if props.get("is_underground"):
                    continue
                geo = mapping(shape)
                features.append({
                    "type": "Feature",
                    "properties": props,
                    "geometry": {"type": geo["type"], "coordinates": round_coords(geo["coordinates"])},
                })
    OUT.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".tmp")
    tmp.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    tmp.rename(dest)
    print(f"[ok] {layer}: {len(features)} features in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    for name in sys.argv[1:] or LAYERS:
        fetch(name)
