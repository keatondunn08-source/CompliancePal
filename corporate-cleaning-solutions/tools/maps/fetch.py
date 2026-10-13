#!/usr/bin/env python3
"""Fetch the Overture Maps layers for the Brisbane service-area maps.

Reads the public Overture bucket on S3 directly (no STAC host needed).

    python3 fetch.py                 # everything (skips layers already cached)
    python3 fetch.py division_area   # one or more named layers
    python3 fetch.py --force ...     # re-download even if cached

Output: .cache/overture/<layer>.parquet  (WKB geometry + a few flat properties)

The suburb polygons are fetched first; the heavy layers (buildings, roads,
water, land use) are then fetched for the union of every frame build_maps.py
will render, so nothing at the edge of a portrait frame is missing.
"""
import json
import sys
import time

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq
from overturemaps import core

from common import ADDRESS_BBOX, DIVISION_BBOX, OVERTURE, RELEASE

DIVISION_SUBTYPES = ["locality", "neighborhood", "macrohood", "microhood", "localadmin"]


def names_primary():
    return pc.field("names", "primary")


# layer -> (overture type, extra filter, {column: expression})
def layer_spec(name):
    g = {"geometry": pc.field("geometry")}
    if name == "division_area":
        return ("division_area",
                (pc.field("country") == "AU") & pc.field("subtype").isin(DIVISION_SUBTYPES),
                {"id": pc.field("id"), "name": names_primary(), "subtype": pc.field("subtype"),
                 "class": pc.field("class"), "admin_level": pc.field("admin_level"),
                 "region": pc.field("region"), "is_land": pc.field("is_land"),
                 "division_id": pc.field("division_id"), **g})
    if name == "address":
        return ("address", None,
                {"number": pc.field("number"), "street": pc.field("street"), "unit": pc.field("unit"),
                 "postcode": pc.field("postcode"), "postal_city": pc.field("postal_city"),
                 "address_levels": pc.field("address_levels"), **g})
    if name == "segment":
        return ("segment", pc.field("subtype").isin(["road", "rail"]),
                {"name": names_primary(), "subtype": pc.field("subtype"), "class": pc.field("class"),
                 "subclass": pc.field("subclass"), "road_flags": pc.field("road_flags"),
                 "rail_flags": pc.field("rail_flags"), "level_rules": pc.field("level_rules"), **g})
    if name == "water":
        return ("water", None,
                {"name": names_primary(), "subtype": pc.field("subtype"), "class": pc.field("class"),
                 "is_salt": pc.field("is_salt"), "is_intermittent": pc.field("is_intermittent"), **g})
    if name == "land_use":
        return ("land_use", None,
                {"name": names_primary(), "subtype": pc.field("subtype"), "class": pc.field("class"), **g})
    if name == "land":
        return ("land", pc.field("subtype") != "tree",
                {"subtype": pc.field("subtype"), "class": pc.field("class"), **g})
    if name == "building":
        return ("building", None,
                {"subtype": pc.field("subtype"), "class": pc.field("class"),
                 "is_underground": pc.field("is_underground"), **g})
    raise SystemExit(f"unknown layer {name}")


LAYERS = ["division_area", "address", "segment", "water", "land_use", "land", "building"]


def fetch(name, bbox, force=False):
    dest = OVERTURE / f"{name}.parquet"
    if dest.exists() and not force:
        print(f"[skip] {dest.name} exists")
        return
    otype, extra, cols = layer_spec(name)
    t0 = time.time()
    dataset, bbox_filter = core._prepare_query(otype, bbox, RELEASE)
    flt = bbox_filter if extra is None else (bbox_filter & extra)
    table = dataset.to_table(filter=flt, columns=cols, use_threads=True,
                             batch_readahead=16, fragment_readahead=8)
    OVERTURE.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".tmp")
    pq.write_table(table, tmp, compression="zstd")
    tmp.rename(dest)
    meta = OVERTURE / "fetch-meta.json"
    m = json.loads(meta.read_text()) if meta.exists() else {}
    m[name] = {"release": RELEASE, "bbox": list(bbox), "rows": table.num_rows,
               "fetched": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    meta.write_text(json.dumps(m, indent=1))
    print(f"[ok] {name}: {table.num_rows} rows, {dest.stat().st_size / 1e6:.1f} MB in {time.time() - t0:.0f}s")


def render_bbox():
    """Union of every frame the build renders (needs division_area)."""
    from build_maps import load_regions, all_frame_bounds_lonlat  # lazy: needs shapely data
    regions = load_regions(verbose=False)
    minx, miny, maxx, maxy = all_frame_bounds_lonlat(regions)
    pad = 0.005
    return (round(minx - pad, 3), round(miny - pad, 3), round(maxx + pad, 3), round(maxy + pad, 3))


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    force = "--force" in sys.argv
    wanted = args or LAYERS
    if "division_area" in wanted:
        fetch("division_area", DIVISION_BBOX, force)
    if "address" in wanted:
        fetch("address", ADDRESS_BBOX, force)
    heavy = [n for n in wanted if n not in ("division_area", "address")]
    if heavy:
        bbox = render_bbox()
        print(f"render bbox (lon/lat): {bbox}")
        for n in heavy:
            fetch(n, bbox, force)


if __name__ == "__main__":
    main()
