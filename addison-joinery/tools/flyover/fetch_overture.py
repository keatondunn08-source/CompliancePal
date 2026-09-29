#!/usr/bin/env python3
"""Fetch the Overture Maps layers used by the flyover renders.

Reads the public Overture bucket on S3 directly. The STAC catalogue host is not
needed, so this works in locked-down CI/cloud environments that allow S3.

Usage:  python3 fetch_overture.py            # all layers for REGION_BBOX
Output: .cache/overture/<layer>.geojson      (lon/lat, trimmed properties)
"""
import json
import sys
import time
from pathlib import Path

from overturemaps import core
from shapely import wkb
from shapely.geometry import mapping

RELEASE = "2026-09-23.1"
# Union of every service-area camera path in areas.json, plus margin.
REGION_BBOX = (151.140, -33.935, 151.315, -33.755)

OUT = Path(__file__).parent / ".cache" / "overture"

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
    reader = core.record_batch_reader(otype, bbox=REGION_BBOX, release=RELEASE, stac=False)
    if reader is None:
        raise SystemExit(f"failed to open {otype}")
    features = []
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
