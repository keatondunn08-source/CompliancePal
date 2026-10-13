#!/usr/bin/env python3
"""Build the Brisbane service-area map imagery and geometry data.

    python3 build_maps.py                       # everything
    python3 build_maps.py --only=data           # regions-map.json + region-facts.json
    python3 build_maps.py --only=heroes --regions=southside --frames=landscape
    python3 build_maps.py --only=og
    python3 build_maps.py --keep                # also keep PNG masters in .cache/preview
    python3 build_maps.py --base=street         # geocode the base from the street midpoint

Inputs:  .cache/overture/*.parquet (fetch.py)
Outputs: site/assets/img/map/<id>-*.webp, site/assets/img/og.jpg,
         tools/build/data/regions-map.json, tools/build/data/region-facts.json
"""
import base64
import json
import math
import shutil
import subprocess
import sys
import time

import numpy as np
import pyarrow.parquet as pq
import shapely
from shapely.geometry import LineString, MultiLineString, Point, Polygon
from shapely.ops import linemerge, polygonize, polylabel, substring, unary_union
from shapely.strtree import STRtree

from common import (ALIASES, BASE_ADDRESS, CACHE, FRAMES, HERE, OVERTURE, PROJECT, R_MERC, REGIONS,
                    RELEASE, frame_box, haversine_km, merc, unmerc)

SITE = PROJECT / "site"
OUT_IMG = SITE / "assets" / "img" / "map"
OUT_OG = SITE / "assets" / "img" / "og.jpg"
OUT_DATA = PROJECT / "tools" / "build" / "data"
FONT = SITE / "assets" / "fonts" / "archivo-var.woff2"
RENDER = CACHE / "render"
PREVIEW = CACHE / "preview"
CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

CREDITS = ("Map data © OpenStreetMap contributors (ODbL 1.0) and Overture Maps Foundation "
           "(release " + RELEASE + "; ODbL 1.0 / CDLA-Permissive-2.0), including Microsoft ML Buildings "
           "(ODbL 1.0) and Esri Community Maps (CC0 1.0).")


def log(*a):
    print(*a, flush=True)


# ============================================================== projection helpers

def to_merc(g):
    def f(c):
        return np.column_stack((np.radians(c[:, 0]) * R_MERC,
                                np.log(np.tan(np.pi / 4 + np.radians(c[:, 1]) / 2)) * R_MERC))
    return shapely.transform(g, f)


def from_merc(g):
    def f(c):
        return np.column_stack((np.degrees(c[:, 0] / R_MERC),
                                np.degrees(2 * np.arctan(np.exp(c[:, 1] / R_MERC)) - np.pi / 2)))
    return shapely.transform(g, f)


_A, _E2 = 6378137.0, 0.00669437999014
_E = math.sqrt(_E2)


def equal_area(g, lat0=-27.5):
    """Cylindrical equal-area on the WGS84 ellipsoid (metres), standard parallel lat0."""
    k0 = math.cos(math.radians(lat0)) / math.sqrt(1 - _E2 * math.sin(math.radians(lat0)) ** 2)

    def f(c):
        s = np.sin(np.radians(c[:, 1]))
        q = (1 - _E2) * (s / (1 - _E2 * s * s) - (1 / (2 * _E)) * np.log((1 - _E * s) / (1 + _E * s)))
        return np.column_stack((_A * k0 * np.radians(c[:, 0]), _A * q / (2 * k0)))
    return shapely.transform(g, f)


def local_metres(g, lon0, lat0):
    """Local equirectangular metres around (lon0, lat0); fine for lengths/buffers at suburb scale."""
    kx = 111320.0 * math.cos(math.radians(lat0))
    ky = 110574.0
    return shapely.transform(g, lambda c: np.column_stack(((c[:, 0] - lon0) * kx, (c[:, 1] - lat0) * ky)))


def polys(g):
    if g is None or g.is_empty:
        return []
    if g.geom_type == "Polygon":
        return [g]
    if hasattr(g, "geoms"):
        return [p for sub in g.geoms for p in polys(sub)]
    return []


def clean(g, eps):
    """Close hairline gaps between adjacent suburb polygons."""
    return shapely.make_valid(g.buffer(eps, join_style="mitre").buffer(-eps, join_style="mitre"))


# ============================================================== regions

def load_divisions():
    t = pq.read_table(OVERTURE / "division_area.parquet").to_pylist()
    rank = {"locality": 0, "macrohood": 1, "neighborhood": 2, "localadmin": 3, "microhood": 4}
    out = {}
    for r in t:
        if not r["name"]:
            continue
        g = shapely.from_wkb(r["geometry"])
        key = r["name"].lower()
        prev = out.get(key)
        if prev is None or rank.get(r["subtype"], 9) < rank.get(prev["subtype"], 9):
            out[key] = {"name": r["name"], "subtype": r["subtype"], "geom": g, "id": r["id"]}
    return out


def load_regions(verbose=True):
    divs = load_divisions()
    regions = []
    for cfg in REGIONS:
        subs, unmatched = [], []
        for want in cfg["suburbs"]:
            hit = None
            for alias in ALIASES.get(want, [want]):
                d = divs.get(alias.lower())
                # guard against a metropolitan-sized "Brisbane" polygon
                if d and d["geom"].area < 0.005:
                    hit = d
                    break
            if hit is None:
                unmatched.append(want)
                continue
            subs.append({"name": want, "matched": hit["name"], "subtype": hit["subtype"],
                         "overture_id": hit["id"], "ll": hit["geom"], "m": to_merc(hit["geom"])})
        union_m = clean(unary_union([s["m"] for s in subs]), 3.0)
        union_m = shapely.MultiPolygon(polys(union_m)) if len(polys(union_m)) > 1 else polys(union_m)[0]
        union_ll = from_merc(union_m)
        c_ll = equal_area_centroid(union_ll)
        reg = {**cfg, "subs": subs, "unmatched": unmatched, "union_m": union_m, "union_ll": union_ll,
               "centroid_ll": c_ll, "centroid_m": merc(*c_ll)}
        regions.append(reg)
        if verbose:
            log(f"  {cfg['id']}: " + ", ".join(f"{s['name']}->{s['matched']} ({s['subtype']})" for s in subs)
                + (f"  UNMATCHED: {unmatched}" if unmatched else ""))
    return regions


def equal_area_centroid(g_ll):
    """Area-weighted centroid computed in an equal-area projection, returned as lon/lat."""
    ea = equal_area(g_ll)
    c = ea.centroid
    k0 = math.cos(math.radians(-27.5)) / math.sqrt(1 - _E2 * math.sin(math.radians(-27.5)) ** 2)
    lon = math.degrees(c.x / (_A * k0))
    # invert q for latitude by bisection (monotonic)
    target = c.y * 2 * k0 / _A
    lo, hi = -89.0, 89.0
    for _ in range(80):
        mid = (lo + hi) / 2
        s = math.sin(math.radians(mid))
        q = (1 - _E2) * (s / (1 - _E2 * s * s) - (1 / (2 * _E)) * math.log((1 - _E * s) / (1 + _E * s)))
        if q < target:
            lo = mid
        else:
            hi = mid
    return (lon, (lo + hi) / 2)


def og_frame(regions):
    allm = unary_union([r["union_m"] for r in regions])
    minx, miny, maxx, maxy = allm.bounds
    W, H = 1200, 630
    scale = min(0.86 * W / (maxx - minx), 0.84 * H / (maxy - miny))
    cx, cy = (minx + maxx) / 2, (miny + maxy) / 2
    return (cx - W / 2 / scale, cy - H / 2 / scale, cx + W / 2 / scale, cy + H / 2 / scale), scale


def overview_frame(regions):
    """regions-map.json frame: union of the six regions + 8% padding."""
    allm = unary_union([r["union_m"] for r in regions])
    minx, miny, maxx, maxy = allm.bounds
    px, py = (maxx - minx) * 0.08, (maxy - miny) * 0.08
    return (minx - px, miny - py, maxx + px, maxy + py)


def region_frames(reg):
    out = {}
    for name, fr in FRAMES.items():
        out[name] = frame_box(reg["union_m"].bounds, reg["centroid_m"], fr)
    return out


def all_frame_bounds_lonlat(regions):
    boxes = [overview_frame(regions), og_frame(regions)[0]]
    for r in regions:
        boxes += [b for b, _ in region_frames(r).values()]
    minx = min(b[0] for b in boxes)
    miny = min(b[1] for b in boxes)
    maxx = max(b[2] for b in boxes)
    maxy = max(b[3] for b in boxes)
    lon0, lat0 = unmerc(minx, miny)
    lon1, lat1 = unmerc(maxx, maxy)
    return lon0, lat0, lon1, lat1


# ============================================================== base location

def geocode_base(method="address"):
    """19 Bracken Street, Moorooka from Overture addresses; else Bracken St midpoint.

    method="street" skips the address lookup (the Australian address records in
    Overture come from a source tagged LicenseRef-Proprietary; the street geometry is OSM/ODbL).
    """
    rows = pq.read_table(OVERTURE / "address.parquet").to_pylist() if method == "address" else []
    for r in rows:
        levels = " ".join((lv.get("value") or "") for lv in (r.get("address_levels") or [])).upper()
        if (r["number"] == BASE_ADDRESS["number"] and (r["street"] or "").upper() == BASE_ADDRESS["street"].upper()
                and (BASE_ADDRESS["suburb"].upper() in levels or r["postcode"] == BASE_ADDRESS["postcode"])):
            p = shapely.from_wkb(r["geometry"])
            return {"lngLat": [round(p.x, 6), round(p.y, 6)], "method": "overture-address",
                    "matched": f"{r['number']} {r['street']}, {levels.split()[-1] if levels else ''} {r['postcode'] or ''}".strip()}
    # fallback: midpoint of Bracken Street segments inside Moorooka
    divs = load_divisions()
    moorooka = divs["moorooka"]["geom"].buffer(0.001)
    t = pq.read_table(OVERTURE / "segment.parquet", columns=["name", "geometry"]).to_pylist()
    lines = [shapely.from_wkb(r["geometry"]) for r in t if (r["name"] or "").lower() == "bracken street"]
    lines = [g for g in lines if moorooka.intersects(g)]
    if not lines:
        raise SystemExit("could not geocode the base")
    merged = linemerge(unary_union(lines))
    parts = list(merged.geoms) if hasattr(merged, "geoms") else [merged]
    longest = max(parts, key=lambda g: g.length)
    p = longest.interpolate(0.5, normalized=True)
    return {"lngLat": [round(p.x, 6), round(p.y, 6)], "method": "street-midpoint", "matched": "Bracken Street, Moorooka"}


# ============================================================== map layers

WATER_POLY_SKIP = {"swimming_pool", "fountain", "reflecting_pool", "wastewater", "basin", "drain", "ditch"}
WATER_LINE_KEEP = {"river", "stream", "canal"}
PARK_LANDUSE = {"park", "recreation", "golf", "cemetery", "protected"}
PARK_LANDUSE_SKIP_CLASS = {"water_hazard", "lateral_water_hazard", "bunker", "marina"}
PARK_LAND = {"forest", "grass", "shrub", "wetland"}

ROAD_TIER = {"motorway": "motorway", "trunk": "major", "primary": "major", "secondary": "mid",
             "tertiary": "mid", "residential": "minor", "living_street": "minor", "unclassified": "minor"}


def flag_ranges(flags, name):
    out = []
    for f in flags or []:
        if name in (f.get("values") or []):
            b = f.get("between")
            out.append((0.0, 1.0) if not b else (float(b[0]), float(b[1])))
    return out


def split_by_ranges(line, ranges):
    """-> (inside_parts, outside_parts) for normalised ranges along the line."""
    if not ranges:
        return [], [line]
    ranges = sorted(ranges)
    merged = []
    for a, b in ranges:
        if merged and a <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], b))
        else:
            merged.append((a, b))
    if merged[0][0] <= 0.001 and merged[0][1] >= 0.999:
        return [line], []
    inside, outside, pos = [], [], 0.0
    for a, b in merged:
        if a > pos + 1e-4:
            outside.append(substring(line, pos, a, normalized=True))
        inside.append(substring(line, a, b, normalized=True))
        pos = b
    if pos < 0.9999:
        outside.append(substring(line, pos, 1.0, normalized=True))
    keep = lambda gs: [g for g in gs if g.geom_type == "LineString" and g.length > 0]
    return keep(inside), keep(outside)


class Layers:
    """All map features in Web Mercator metres, grouped by style, each with an STRtree."""

    def __init__(self):
        t0 = time.time()
        self.groups = {}
        self._water()
        self._parks()
        self._buildings()
        self._segments()
        log(f"  layers ready in {time.time() - t0:.1f}s: "
            + ", ".join(f"{k}={len(v[0])}" for k, v in self.groups.items()))

    def add(self, name, geoms):
        arr = np.array([g for g in geoms if g is not None and not g.is_empty], dtype=object)
        arr = to_merc(arr) if len(arr) else arr
        self.groups[name] = (arr, STRtree(arr))

    def _water(self):
        t = pq.read_table(OVERTURE / "water.parquet").to_pylist()
        polys_, lines, river = [], [], []
        for r in t:
            g = shapely.from_wkb(r["geometry"])
            if g.geom_type in ("Polygon", "MultiPolygon"):
                if r["class"] in WATER_POLY_SKIP or r["subtype"] == "human_made":
                    continue
                polys_.append(g)
                if (r["name"] or "").lower() == "brisbane river":
                    river.append(g)
            elif g.geom_type in ("LineString", "MultiLineString") and r["class"] in WATER_LINE_KEEP:
                lines.append(g)
        self.add("water", polys_)
        self.add("creek", lines)
        self.brisbane_river_ll = unary_union(river)

    def _parks(self):
        out = []
        for r in pq.read_table(OVERTURE / "land_use.parquet", columns=["subtype", "class", "geometry"]).to_pylist():
            if r["subtype"] in PARK_LANDUSE and r["class"] not in PARK_LANDUSE_SKIP_CLASS:
                g = shapely.from_wkb(r["geometry"])
                if g.geom_type in ("Polygon", "MultiPolygon"):
                    out.append(g)
        for r in pq.read_table(OVERTURE / "land.parquet", columns=["subtype", "geometry"]).to_pylist():
            if r["subtype"] in PARK_LAND:
                g = shapely.from_wkb(r["geometry"])
                if g.geom_type in ("Polygon", "MultiPolygon"):
                    out.append(g)
        self.add("park", out)

    def _buildings(self):
        t = pq.read_table(OVERTURE / "building.parquet", columns=["is_underground", "geometry"])
        g = shapely.from_wkb(t.column("geometry").to_numpy(zero_copy_only=False))
        under = np.array([bool(v) for v in t.column("is_underground").to_pylist()])
        g = g[~under]
        self.buildings_ll = g
        self.add("building", list(g))

    def _segments(self):
        t = pq.read_table(OVERTURE / "segment.parquet",
                          columns=["subtype", "class", "subclass", "road_flags", "rail_flags", "geometry"]).to_pylist()
        groups = {}

        def put(key, g):
            groups.setdefault(key, []).append(g)

        self.major_roads_ll = []
        for r in t:
            g = shapely.from_wkb(r["geometry"])
            if g.geom_type != "LineString":
                continue
            if r["subtype"] == "rail":
                rf = flag_ranges(r["rail_flags"], "is_tunnel") + flag_ranges(r["rail_flags"], "is_covered")
                dead = any(flag_ranges(r["rail_flags"], f) for f in ("is_abandoned", "is_disused", "is_under_construction"))
                if dead:
                    continue
                _, above = split_by_ranges(g, rf)
                for part in above:
                    put("rail", part)
                continue
            tier = ROAD_TIER.get(r["class"])
            if tier is None:
                continue
            if any(flag_ranges(r["road_flags"], f) for f in ("is_under_construction", "is_abandoned")):
                continue
            link = r["subclass"] == "link"
            tun, above = split_by_ranges(g, flag_ranges(r["road_flags"], "is_tunnel"))
            for part in above:
                put(f"{tier}{'-link' if link else ''}", part)
                if tier in ("motorway", "major") and not link:
                    self.major_roads_ll.append(part)
            for part in tun:
                if tier in ("motorway", "major"):
                    put(f"{tier}-tunnel", part)
        for key in ("rail", "minor", "mid-link", "mid", "major-tunnel", "motorway-tunnel",
                    "major-link", "major", "motorway-link", "motorway"):
            self.add(key, groups.get(key, []))

    def clip(self, name, bbox_m):
        geoms, tree = self.groups[name]
        idx = tree.query(shapely.box(*bbox_m))
        if len(idx) == 0:
            return np.array([], dtype=object)
        g = shapely.clip_by_rect(geoms[np.sort(idx)], *bbox_m)
        return g[~shapely.is_empty(g)]


# ============================================================== SVG helpers

def fmt_num_array(a):
    s = np.char.mod("%.1f", a)
    return np.char.replace(s, ".0", "")


def svg_d(geoms, closed, min_area=0.0):
    """Absolute-coordinate path data for an array of (multi)polygons or (multi)lines in px."""
    if len(geoms) == 0:
        return ""
    parts = shapely.get_parts(geoms)
    tid = shapely.get_type_id(parts)
    if closed:
        parts = parts[tid == 3]
        if min_area:
            parts = parts[shapely.area(parts) >= min_area]
        rings = shapely.get_rings(parts)
    else:
        rings = parts[tid == 1]
    if len(rings) == 0:
        return ""
    coords, idx = shapely.get_coordinates(rings, return_index=True)
    xs, ys = fmt_num_array(np.round(coords[:, 0], 1)), fmt_num_array(np.round(coords[:, 1], 1))
    pairs = np.char.add(np.char.add(xs, " "), ys)
    starts = np.flatnonzero(np.r_[True, idx[1:] != idx[:-1]])
    ends = np.r_[starts[1:], len(idx)]
    out = []
    for a, b in zip(starts, ends):
        if closed:
            b -= 1  # drop the closing duplicate
            if b - a < 3:
                continue
            out.append("M" + pairs[a] + "L" + " ".join(pairs[a + 1:b]) + "Z")
        else:
            if b - a < 2:
                continue
            out.append("M" + pairs[a] + "L" + " ".join(pairs[a + 1:b]))
    return "".join(out)


def ring_d(geom, closed=True):
    """Path data for a single shapely geometry (small things: outlines, overlays)."""
    return svg_d(np.array([geom], dtype=object), closed)


class Frame:
    """A Mercator box mapped onto a W x H pixel canvas."""

    def __init__(self, bbox_m, W, H):
        self.bbox_m, self.W, self.H = bbox_m, W, H
        minx, miny, maxx, maxy = bbox_m
        self.s = W / (maxx - minx)
        self.minx, self.maxy = minx, maxy
        m = 0.04 * (maxx - minx)
        self.clip_m = (minx - m, miny - m, maxx + m, maxy + m)

    def px(self, g):
        s, minx, maxy = self.s, self.minx, self.maxy
        return shapely.transform(g, lambda c: np.column_stack(((c[:, 0] - minx) * s, (maxy - c[:, 1]) * s)))

    def pt(self, x_m, y_m):
        return ((x_m - self.minx) * self.s, (self.maxy - y_m) * self.s)

    def inside(self, x, y, margin=0):
        return margin <= x <= self.W - margin and margin <= y <= self.H - margin


# Palette (from the brief). Line widths are at 1920px wide and multiplied by k.
C = {
    "bg": "#141A2B", "park": "#182237", "water": "#232C4D", "water_edge": "rgba(185,176,255,.45)",
    "creek": "rgba(185,176,255,.20)", "building": "rgba(255,255,255,.035)",
    "minor": "rgba(233,236,246,.20)", "mid": "rgba(233,236,246,.35)", "major": "rgba(233,236,246,.55)",
    "motorway": "rgba(156,140,255,.75)", "rail": "rgba(233,236,246,.18)",
    "tunnel": "rgba(156,140,255,.30)", "major_tunnel": "rgba(233,236,246,.22)",
    "outline": "rgba(233,236,246,.55)", "inner": "rgba(156,140,255,.06)", "dim": "rgba(5,7,15,.17)",
    "divider": "rgba(233,236,246,.17)", "bloom": "#9C8CFF", "label": "rgba(233,236,246,.72)",
    "halo": "rgba(20,26,43,.78)",
}
ROAD_STYLE = [  # group, colour key, width, dash (in width units of k), opacity multiplier
    ("minor", "minor", 0.8, None),
    ("mid-link", "mid", 0.9, None),
    ("mid", "mid", 1.2, None),
    ("major-tunnel", "major_tunnel", 1.2, (3, 3)),
    ("motorway-tunnel", "tunnel", 1.6, (4, 4)),
    ("major-link", "major", 1.2, None),
    ("major", "major", 2.0, None),
    ("motorway-link", "motorway", 1.5, None),
    ("motorway", "motorway", 2.6, None),
]


def basemap_svg(L, F, k, detail=1.0):
    """Background, parks, water, buildings, rail and roads for one frame."""
    out = [f'<rect width="{F.W}" height="{F.H}" fill="{C["bg"]}"/>']
    simp = 0.35
    park = shapely.simplify(F.px(L.clip("park", F.clip_m)), simp)
    park = shapely.orient_polygons(park)
    out.append(f'<path fill="{C["park"]}" d="{svg_d(park, True, min_area=2)}"/>')

    water = F.px(L.clip("water", F.clip_m))
    water = shapely.simplify(unary_union(shapely.make_valid(water)), simp)
    wpoly = np.array(polys(water), dtype=object)
    wpoly = wpoly[shapely.area(wpoly) >= 3] if len(wpoly) else wpoly
    creek = F.px(L.clip("creek", F.clip_m))
    if len(creek) and len(wpoly):
        creek = shapely.difference(creek, unary_union(wpoly))
    creek = shapely.simplify(creek, simp)
    out.append(f'<path fill="none" stroke="{C["creek"]}" stroke-width="{0.9 * k:.2f}" stroke-linecap="round" '
               f'stroke-linejoin="round" d="{svg_d(creek, False)}"/>')
    out.append(f'<path fill="{C["water"]}" stroke="{C["water_edge"]}" stroke-width="{1.5 * k:.2f}" '
               f'stroke-linejoin="round" d="{svg_d(wpoly, True)}"/>')

    if detail > 0:
        b = shapely.simplify(F.px(L.clip("building", F.clip_m)), 0.3)
        b = shapely.orient_polygons(b)
        fill = C["building"] if detail >= 1 else f"rgba(255,255,255,{0.035 * detail:.4f})"
        out.append(f'<path fill="{fill}" d="{svg_d(b, True, min_area=0.6)}"/>')

    rail = shapely.simplify(F.px(L.clip("rail", F.clip_m)), simp)
    out.append(f'<path fill="none" stroke="{C["rail"]}" stroke-width="{1.2 * k:.2f}" '
               f'stroke-dasharray="{4 * k:.2f} {3 * k:.2f}" d="{svg_d(rail, False)}"/>')
    for group, col, w, dash in ROAD_STYLE:
        g = shapely.simplify(F.px(L.clip(group, F.clip_m)), simp)
        colour = C[col]
        if group == "minor" and detail < 1:
            colour = f"rgba(233,236,246,{0.20 * (0.75 + 0.25 * detail):.3f})"
        d = svg_d(g, False)
        if not d:
            continue
        da = f' stroke-dasharray="{dash[0] * k:.2f} {dash[1] * k:.2f}"' if dash else ""
        out.append(f'<path fill="none" stroke="{colour}" stroke-width="{w * k:.2f}" stroke-linecap="round" '
                   f'stroke-linejoin="round"{da} d="{d}"/>')
    return "\n".join(out)


def region_overlay_svg(F, region_geoms_m, k, dividers_m=None, outline_w=1.5, outline=None, inner=None, dim=None):
    """Inner fill, outside dim, suburb dividers and outline for one or more regions."""
    gpx = [F.px(g) for g in region_geoms_m]
    union_px = unary_union(gpx)
    W, H = F.W, F.H
    rings = ring_d(union_px)
    out = [f'<path fill="{inner or C["inner"]}" d="{"".join(ring_d(g) for g in gpx)}"/>',
           f'<path fill="{dim or C["dim"]}" fill-rule="evenodd" d="M-20 -20H{W + 20}V{H + 20}H-20Z{rings}"/>']
    if dividers_m is not None and not dividers_m.is_empty:
        dv = shapely.simplify(F.px(dividers_m), 0.3)
        out.append(f'<path fill="none" stroke="{C["divider"]}" stroke-width="{0.8 * k:.2f}" '
                   f'stroke-dasharray="{3 * k:.2f} {3 * k:.2f}" d="{ring_d(dv, closed=False)}"/>')
    outline_d = "".join(ring_d(g) for g in gpx)
    outline_col = outline or C["outline"]
    out.append(f'<path fill="none" stroke="{outline_col}" stroke-width="{outline_w * k:.2f}" stroke-linejoin="round" '
               f'd="{outline_d}"/>')
    return "\n".join(out)


def base_marker_svg(x, y, k):
    return (f'<g><circle cx="{x:.1f}" cy="{y:.1f}" r="{14 * k:.1f}" fill="rgba(156,140,255,.16)"/>'
            f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{6.5 * k:.1f}" fill="{C["bg"]}" stroke="{C["bloom"]}" '
            f'stroke-width="{2 * k:.2f}"/>'
            f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{2.2 * k:.1f}" fill="{C["bloom"]}"/></g>')


def internal_dividers(reg):
    lines = unary_union([s["m"].boundary for s in reg["subs"]])
    return lines.difference(reg["union_m"].boundary.buffer(4.0))


# ============================================================== labels

def label_candidates(poly_px, n=12):
    P = max(polys(poly_px), key=lambda p: p.area)
    c0 = polylabel(P, tolerance=0.5)
    minx, miny, maxx, maxy = P.bounds
    step = max(4.0, math.sqrt(P.area) / 10)
    X, Y = np.meshgrid(np.arange(minx + step / 2, maxx, step), np.arange(miny + step / 2, maxy, step))
    X, Y = X.ravel(), Y.ravel()
    inside = shapely.contains_xy(P, X, Y)
    pts = np.column_stack((X[inside], Y[inside]))
    cands = [(c0.x, c0.y)]
    if len(pts):
        d = shapely.distance(P.exterior, shapely.points(pts))
        order = np.argsort(-d)
        for i in order:
            x, y = pts[i]
            if all(math.hypot(x - cx, y - cy) > step * 1.6 for cx, cy in cands):
                cands.append((float(x), float(y)))
            if len(cands) >= n:
                break
    out = []
    for x, y in cands:
        chord = 0.0
        line = LineString([(minx - 1, y), (maxx + 1, y)]).intersection(P)
        for seg in ([line] if line.geom_type == "LineString" else getattr(line, "geoms", [])):
            if seg.geom_type == "LineString" and seg.distance(Point(x, y)) < 1e-6:
                chord = seg.length
        out.append([round(x, 1), round(y, 1), round(chord, 1)])
    return out


def label_lines(name):
    up = name.upper()
    words = up.split()
    if len(words) == 1:
        return [[up]]
    # best two-line split: most balanced
    best = min(range(1, len(words)), key=lambda i: abs(len(" ".join(words[:i])) - len(" ".join(words[i:]))))
    return [[up], [" ".join(words[:best]), " ".join(words[best:])]]


def in_zone(x, y, zone):
    return zone is not None and zone[0] <= x <= zone[2] and zone[1] <= y <= zone[3]


def labels_for(reg, F, zone=None):
    """Label candidates per suburb; candidate points inside the headline zone are dropped,
    and a suburb with no candidate left gets no label."""
    labels, dropped = [], []
    for s in sorted(reg["subs"], key=lambda s: s["m"].area):
        p = F.px(s["m"]).intersection(shapely.box(0, 0, F.W, F.H))
        if p.is_empty:
            dropped.append(s["name"])
            continue
        cands = [c for c in label_candidates(p) if not in_zone(c[0], c[1], zone)]
        if not cands:
            dropped.append(s["name"])
            continue
        labels.append({"name": s["name"], "lines": label_lines(s["name"]), "cands": cands})
    return labels, dropped


LABEL_JS = r"""
(async () => {
  const NS = 'http://www.w3.org/2000/svg';
  const D = window.__LABELS;
  const g = document.getElementById('labels');
  await document.fonts.load(`600 ${D.size}px Archivo`);
  await document.fonts.ready;
  const mk = (lines, x, y, size) => {
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('class', 'lbl');
    t.setAttribute('font-size', size.toFixed(2));
    t.setAttribute('stroke-width', (size * D.halo).toFixed(2));
    const lh = size * 1.18;
    lines.forEach((s, i) => {
      const ts = document.createElementNS(NS, 'tspan');
      ts.setAttribute('x', (x + size * 0.07).toFixed(1)); // trailing letter-spacing
      ts.setAttribute('y', (y + (i - (lines.length - 1) / 2) * lh).toFixed(1));
      ts.textContent = s;
      t.appendChild(ts);
    });
    return t;
  };
  const pad = (b, p, px = p) => ({ x0: b.x - px, y0: b.y - p, x1: b.x + b.width + px, y1: b.y + b.height + p });
  const hit = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  const inFrame = (b) => b.x0 >= D.margin && b.y0 >= D.margin && b.x1 <= D.W - D.margin && b.y1 <= D.H - D.margin;
  const placed = D.avoid.map((a) => ({ x0: a[0], y0: a[1], x1: a[2], y1: a[3] }));
  const zones = D.zones.map((a) => ({ x0: a[0], y0: a[1], x1: a[2], y1: a[3] }));
  const layout = [];
  for (const L of D.labels) {
    let done = null;
    for (const scale of [1, 0.9, 0.8]) {
      const size = D.size * scale;
      for (const [x, y, chord] of L.cands) {
        const opts = L.lines.map((v) => { const t = mk(v, x, y, size); g.appendChild(t); return { t, v, b: t.getBBox() }; });
        if (opts.length > 1 && opts[0].b.width > chord * 1.05) opts.reverse();
        for (const o of opts) {
          const bx = pad(o.b, size * 0.3, size * 0.9);
          if (inFrame(bx) && !placed.some((p) => hit(p, bx)) && !zones.some((z) => hit(z, pad(o.b, size * 0.3)))) {
            done = { ...o, bx, x, y, size }; break;
          }
        }
        for (const o of opts) if (!done || o.t !== done.t) o.t.remove();
        if (done) break;
      }
      if (done) break;
    }
    if (!done && zones.length) {  // hero frames: omit rather than collide with the headline
      console.log('[label] omitted ' + L.name + ' (no spot clear of labels and the headline zone)');
      layout.push({ name: L.name, omitted: true });
      continue;
    }
    if (!done) {
      console.log('[label] no free spot for ' + L.name + ', placing at best candidate');
      const [x, y] = L.cands[0];
      const v = L.lines[L.lines.length - 1];
      const t = mk(v, x, y, D.size * 0.8); g.appendChild(t);
      done = { t, v, bx: pad(t.getBBox(), 0), x, y, size: D.size * 0.8, forced: true };
    }
    placed.push(done.bx);
    layout.push({ name: L.name, lines: done.v, x: done.x, y: done.y, size: +done.size.toFixed(2), forced: !!done.forced });
  }
  window.__layout = layout;
  window.__ready = true;
})();
"""

_FONT_B64 = None


def html_page(svg_body, W, H, labels=None, label_size=0, avoid=(), margin=0, zones=()):
    global _FONT_B64
    if _FONT_B64 is None:
        _FONT_B64 = base64.b64encode(FONT.read_bytes()).decode()
    data = {"labels": labels or [], "size": label_size, "avoid": list(avoid), "W": W, "H": H,
            "margin": margin, "halo": 0.32, "zones": [list(z) for z in zones]}
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{{font-family:Archivo;src:url(data:font/woff2;base64,{_FONT_B64}) format('woff2');font-weight:500 800;font-stretch:100% 125%}}
html,body{{margin:0;padding:0;background:{C['bg']};overflow:hidden}}
svg{{display:block}}
.lbl{{font-family:Archivo;font-weight:600;font-stretch:125%;font-variation-settings:'wdth' 125,'wght' 600;
text-transform:uppercase;letter-spacing:.14em;fill:{C['label']};stroke:{C['halo']};paint-order:stroke;
stroke-linejoin:round;text-anchor:middle;dominant-baseline:central}}
</style></head><body>
<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
{svg_body}
<g id="labels"></g>
</svg>
<script>window.__LABELS={json.dumps(data)};</script>
<script>{LABEL_JS if labels else 'window.__ready=true;'}</script>
</body></html>"""


# ============================================================== hero / card frames

# Per-frame-kind styling. k multiplies the 1920px line widths; label = font size as a fraction of width.
KIND_STYLE = {
    "landscape": {"k": 2560 / 1920, "label": 0.0105},
    "portrait": {"k": 1080 / 1920 * 1.35, "label": 0.021},
    "card": {"k": 1200 / 1920 * 1.3, "label": 0.019},
}

OUTPUTS = {  # kind -> [(suffix, w, h, byte budget)]
    "landscape": [("-960", 960, 540, 70_000), ("-1440", 1440, 810, 130_000),
                  ("-1920", 1920, 1080, 210_000), ("-2560", 2560, 1440, 330_000)],
    "portrait": [("-portrait-720", 720, 1280, 90_000), ("-portrait-1080", 1080, 1920, 180_000)],
    "card": [("-card", 800, 500, 60_000), ("-card-1200", 1200, 750, 115_000)],
}


def build_region_page(L, reg, kind, base, detail=1.0):
    fr = FRAMES[kind]
    bbox_m, _ = region_frames(reg)[kind]
    F = Frame(bbox_m, fr["w"], fr["h"])
    st = KIND_STYLE[kind]
    k = st["k"]
    body = [basemap_svg(L, F, k, detail),
            region_overlay_svg(F, [reg["union_m"]], k, internal_dividers(reg))]
    tz = fr.get("text_zone")
    zone = (tz[0] * F.W, tz[1] * F.H, tz[2] * F.W, tz[3] * F.H) if tz else None
    avoid = []
    bx, by = F.pt(*base["m"])
    r = 15 * k
    marker_in_zone = zone is not None and not (bx + r < zone[0] or bx - r > zone[2] or by + r < zone[1] or by - r > zone[3])
    # skip a marker hugging the frame edge or sitting under the headline
    if F.inside(bx, by, margin=0.05 * min(F.W, F.H)) and not marker_in_zone:
        body.append(base_marker_svg(bx, by, k))
        avoid.append([bx - r, by - r, bx + r, by + r])
    labels, dropped = labels_for(reg, F, zone)
    if dropped:
        log(f"    {reg['id']}-{kind}: no label (headline zone/outside frame): {', '.join(dropped)}")
    html = html_page("\n".join(body), F.W, F.H, labels, st["label"] * F.W, avoid, margin=0.02 * F.W,
                     zones=[zone] if zone else ())
    return html, F


# ============================================================== encoding

FFMPEG = shutil.which("ffmpeg") or "ffmpeg"


def ffmpeg(*args):
    subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def encode_webp(master_png, out, w, h, budget, qmax=86, qmin=25):
    """Lanczos downscale with ffmpeg, then the highest WebP quality that fits the byte budget."""
    tmp_png = RENDER / f"{out.stem}.scaled.png"
    ffmpeg("-i", str(master_png), "-vf", f"scale={w}:{h}:flags=lanczos", str(tmp_png))
    tmp = RENDER / f"{out.stem}.q.webp"

    def enc(q):
        ffmpeg("-i", str(tmp_png), "-c:v", "libwebp", "-pix_fmt", "yuv420p", "-quality", str(q),
               "-compression_level", "6", "-preset", "picture", str(tmp))
        return tmp.stat().st_size

    lo, hi, best = qmin, qmax, None
    if enc(qmax) <= budget:
        best = qmax
    else:
        while lo <= hi:
            mid = (lo + hi) // 2
            if enc(mid) <= budget:
                best, lo = mid, mid + 1
            else:
                hi = mid - 1
    if best is None:
        best = qmin
        log(f"  !! {out.name}: over budget even at q={qmin}")
    size = enc(best)
    shutil.move(tmp, out)
    tmp_png.unlink(missing_ok=True)
    return best, size


def run_renderer(jobs):
    jf = RENDER / "jobs.json"
    jf.write_text(json.dumps(jobs))
    subprocess.run(["node", str(HERE / "render.mjs"), str(jf)], check=True, cwd=HERE)


# ============================================================== data outputs

def simplify_coverage(geoms_px, tol):
    """Simplify polygons that share edges without opening gaps (shared-arc simplification)."""
    lines = unary_union([g.boundary for g in geoms_px])
    merged = linemerge(lines)
    arcs = list(merged.geoms) if hasattr(merged, "geoms") else [merged]
    arcs = [a.simplify(tol) for a in arcs]
    faces = list(polygonize(arcs))
    tree = STRtree(geoms_px)
    out = [[] for _ in geoms_px]
    for f in faces:
        best, best_a = None, 0.0
        for i in tree.query(f):
            a = f.intersection(geoms_px[i]).area
            if a > best_a:
                best, best_a = i, a
        if best is not None and best_a > 0.5 * f.area:
            out[best].append(f)
    return [unary_union(fs) for fs in out]


def collapse_parallel(lines, width, min_len):
    """Drop line parts that run within `width` of a longer, already kept line.

    Collapses dual carriageways and overlapping segments into one stroke for a
    small-scale map. Lines are processed longest first.
    """
    parts = [l for l in (lines.geoms if hasattr(lines, "geoms") else [lines]) if l.geom_type == "LineString"]
    parts.sort(key=lambda l: -l.length)
    kept, cover = [], None
    for l in parts:
        rest = l if cover is None else l.difference(cover)
        for seg in ([rest] if rest.geom_type == "LineString" else getattr(rest, "geoms", [])):
            if seg.geom_type == "LineString" and seg.length >= min_len:
                kept.append(seg)
                b = seg.buffer(width, cap_style="flat")
                cover = b if cover is None else cover.union(b)
    return linemerge(MultiLineString(kept)) if kept else MultiLineString()


def _num(v):
    """Tenths (int) -> compact SVG number."""
    neg = v < 0
    v = abs(int(v))
    s = str(v // 10) if v % 10 == 0 else f"{v // 10}.{v % 10}"
    if s.startswith("0."):
        s = s[1:]
    return ("-" + s) if neg else s


def compact_d(geom, closed=True, min_len=0.0):
    """Path data with an absolute moveto then relative linetos, coordinates rounded to 0.1."""
    out = []
    if closed:
        rings = [r for p in polys(geom) for r in (p.exterior, *p.interiors)]
    else:
        rings = [geom] if geom.geom_type == "LineString" else [l for l in getattr(geom, "geoms", []) if l.geom_type == "LineString"]
        rings = [r for r in rings if r.length >= min_len]
    for r in rings:
        q = np.round(np.asarray(r.coords)[:, :2] * 10).astype(np.int64)
        keep = np.r_[True, np.any(q[1:] != q[:-1], axis=1)]
        q = q[keep]
        if closed:
            if len(q) > 1 and (q[0] == q[-1]).all():
                q = q[:-1]
            if len(q) < 3:
                continue
        elif len(q) < 2:
            continue
        toks = ["M" + _num(q[0][0]) + " " + _num(q[0][1]) + "l"]
        nums = []
        for dx, dy in np.diff(q, axis=0):
            nums += [_num(dx), _num(dy)]
        s = nums[0] if nums else ""
        for n in nums[1:]:
            s += n if n.startswith("-") else " " + n
        toks.append(s)
        if closed:
            toks.append("z")
        out.append("".join(toks))
    return "".join(out)


def build_regions_map(L, regions, base, facts, budget=45_000):
    """regions-map.json; simplification is stepped up until the file is under budget."""
    for tol in (1.3, 1.5, 1.8, 2.2, 2.7):
        out = regions_map_data(L, regions, base, facts, tol)
        text = json.dumps(out, separators=(",", ":"), ensure_ascii=False)
        if len(text.encode()) <= budget - 500:
            break
    dest = OUT_DATA / "regions-map.json"
    dest.write_text(text)
    log(f"  wrote {dest.relative_to(PROJECT)} ({dest.stat().st_size:,} bytes, tolerance {tol})")
    preview_regions_map(out)
    return out


def regions_map_data(L, regions, base, facts, tol):
    bbox_m = overview_frame(regions)
    W = 1000.0
    s = W / (bbox_m[2] - bbox_m[0])
    H = round((bbox_m[3] - bbox_m[1]) * s, 1)
    F = Frame(bbox_m, 1000, H)
    frame_px = shapely.box(0, 0, 1000, H)

    subs = [(reg, sub) for reg in regions for sub in reg["subs"]]
    sub_px = [F.px(sub["m"]) for _, sub in subs]
    sub_simple = simplify_coverage(sub_px, tol)

    suburbs_out = []
    by_region = {}
    for (reg, sub), g in zip(subs, sub_simple):
        by_region.setdefault(reg["id"], []).append(g)
        lp = polylabel(max(polys(g), key=lambda p: p.area), tolerance=0.2)
        suburbs_out.append({"name": sub["name"], "region": reg["id"], "d": compact_d(g),
                            "label": [round(lp.x, 1), round(lp.y, 1)]})

    regions_out = []
    for reg in regions:
        g = unary_union(by_region[reg["id"]])
        lp = polylabel(max(polys(g), key=lambda p: p.area), tolerance=0.2)
        f = facts[reg["id"]]
        regions_out.append({"id": reg["id"], "name": reg["name"], "d": compact_d(g),
                            "label": [round(lp.x, 1), round(lp.y, 1)],
                            "suburbs": [sb["name"] for sb in reg["subs"]],
                            "centroid": [round(reg["centroid_ll"][0], 5), round(reg["centroid_ll"][1], 5)],
                            "kmFromBase": f["kmFromBase"], "areaKm2": f["areaKm2"]})

    # water: polygons only, clipped to the frame
    water = F.px(L.clip("water", bbox_m))
    water = unary_union(shapely.make_valid(water)).intersection(frame_px)
    water = shapely.simplify(water, tol)
    water = shapely.MultiPolygon([p for p in polys(water) if p.area >= 30]) if polys(water) else water
    # major roads: motorway + trunk + primary (no links, no tunnels); dual carriageways collapsed
    roads = [F.px(L.clip(gname, bbox_m)) for gname in ("motorway", "major")]
    roads = np.concatenate([r for r in roads if len(r)])
    roads = linemerge(unary_union(roads).intersection(frame_px))
    roads = shapely.simplify(collapse_parallel(roads, 2.5, 6), max(1.2, tol - 0.1))

    bx, by = F.pt(*base["m"])
    out = {
        "viewBox": f"0 0 1000 {_num(round(H * 10))}",
        "projection": "EPSG:3857 (Web Mercator), x scaled to 1000 units; frame = union of regions + 8% padding",
        "bounds": [round(v, 5) for v in (*unmerc(bbox_m[0], bbox_m[1]), *unmerc(bbox_m[2], bbox_m[3]))],
        "water": compact_d(water),
        "roads": compact_d(roads, closed=False, min_len=4),
        "regions": regions_out,
        "suburbs": suburbs_out,
        "base": {"x": round(bx, 1), "y": round(by, 1), "lngLat": base["lngLat"], "method": base["method"]},
        "credits": CREDITS,
    }
    return out


def preview_regions_map(m):
    """Light-theme SVG of regions-map.json, only for eyeballing the geometry."""
    PREVIEW.mkdir(parents=True, exist_ok=True)
    hues = ["#9C8CFF", "#5BC0BE", "#F4A261", "#E76F51", "#2A9D8F", "#8AB17D"]
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{m["viewBox"]}" width="1000" '
             f'style="background:#F6F5FB;font-family:sans-serif">',
             f'<path d="{m["water"]}" fill="#CFE0F3"/>',
             f'<path d="{m["roads"]}" fill="none" stroke="#B9B6C9" stroke-width="1.4" stroke-linecap="round"/>']
    for i, r in enumerate(m["regions"]):
        parts.append(f'<path d="{r["d"]}" fill="{hues[i]}" fill-opacity=".18" stroke="{hues[i]}" stroke-width="1.6"/>')
    for s in m["suburbs"]:
        parts.append(f'<path d="{s["d"]}" fill="none" stroke="#1F2440" stroke-opacity=".25" stroke-width=".6"/>')
        parts.append(f'<text x="{s["label"][0]}" y="{s["label"][1]}" font-size="7" text-anchor="middle" '
                     f'fill="#1F2440" fill-opacity=".6">{s["name"]}</text>')
    for r in m["regions"]:
        parts.append(f'<text x="{r["label"][0]}" y="{r["label"][1] - 9}" font-size="11" font-weight="700" '
                     f'text-anchor="middle" fill="#1F2440">{r["name"].replace("&", "&amp;")}</text>')
    b = m["base"]
    parts.append(f'<circle cx="{b["x"]}" cy="{b["y"]}" r="5" fill="none" stroke="#6B5BEF" stroke-width="2"/>')
    parts.append("</svg>")
    (PREVIEW / "regions-map-preview.svg").write_text("\n".join(parts))


def build_facts(L, regions, base):
    blds = L.buildings_ll
    cx = shapely.get_x(shapely.centroid(blds))
    cy = shapely.get_y(shapely.centroid(blds))
    river_m = local_metres(L.brisbane_river_ll, 153.03, -27.48).buffer(50)
    facts = {}
    for reg in regions:
        u = reg["union_ll"]
        shapely.prepare(u)
        n = int(shapely.contains_xy(u, cx, cy).sum())
        area = equal_area(u).area / 1e6
        boundary_m = local_metres(u.boundary, 153.03, -27.48)
        frontage = boundary_m.intersection(river_m).length / 1000
        facts[reg["id"]] = {
            "name": reg["name"],
            "suburbs": [s["name"] for s in reg["subs"]],
            "matchedNames": {s["name"]: s["matched"] for s in reg["subs"]},
            "unmatched": reg["unmatched"],
            "buildingCount": n,
            "kmFromBase": round(haversine_km(base["lngLat"], reg["centroid_ll"]), 1),
            "areaKm2": round(area, 1),
            "riverFrontageKm": round(frontage, 1),
        }
    out = {"_about": {
        "source": f"Overture Maps Foundation release {RELEASE} (divisions, buildings, base water); "
                  "data © OpenStreetMap contributors and others, ODbL / CDLA-Permissive-2.0.",
        "base": {**base_public(base)},
        "buildingCount": "Overture building footprints (not underground) whose centroid lies inside the region polygon.",
        "kmFromBase": "Haversine distance from the base to the region's area-weighted centroid.",
        "areaKm2": "Area of the union of the region's suburb polygons (WGS84 equal-area).",
        "riverFrontageKm": "Length of the region boundary within 50 m of Brisbane River water polygons.",
    }, **facts}
    dest = OUT_DATA / "region-facts.json"
    dest.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    log(f"  wrote {dest.relative_to(PROJECT)} ({dest.stat().st_size:,} bytes)")
    return facts


def base_public(base):
    return {"lngLat": base["lngLat"], "method": base["method"], "matched": base["matched"]}


# ============================================================== OG image

def build_og(L, regions, base):
    (minx, miny, maxx, maxy), _ = og_frame(regions)
    W, H = 2400, 1260  # rendered at 2x, downscaled to 1200x630
    F = Frame((minx, miny, maxx, maxy), W, H)
    k = W / 1920 * 1.1
    # At OG zoom the brief's 1.5px outline disappears into the street grid, so the
    # six regions get a heavier outline, a touch more inner fill and deeper dimming.
    body = [basemap_svg(L, F, k),
            region_overlay_svg(F, [r["union_m"] for r in regions], k, outline_w=2.6,
                               outline="rgba(233,236,246,.78)", inner="rgba(156,140,255,.11)",
                               dim="rgba(5,7,15,.34)")]
    bx, by = F.pt(*base["m"])
    body.append(base_marker_svg(bx, by, k))
    html = RENDER / "og.html"
    html.write_text(html_page("\n".join(body), W, H))
    png = RENDER / "og.png"
    return {"html": str(html), "png": str(png), "w": W, "h": H}, png


def encode_og(png, budget=150_000):
    from PIL import Image
    small = RENDER / "og-1200.png"
    ffmpeg("-i", str(png), "-vf", "scale=1200:630:flags=lanczos", str(small))
    img = Image.open(small).convert("RGB")
    best = None
    for q in range(92, 50, -2):
        img.save(OUT_OG, "JPEG", quality=q, optimize=True, progressive=True, subsampling=0 if q >= 88 else 2)
        if OUT_OG.stat().st_size <= budget:
            best = q
            break
    return best, OUT_OG.stat().st_size


# ============================================================== previews

def contact_sheets(regions):
    from PIL import Image
    PREVIEW.mkdir(parents=True, exist_ok=True)
    tiles = [Image.open(OUT_IMG / f"{r['id']}-960.webp").convert("RGB") for r in regions
             if (OUT_IMG / f"{r['id']}-960.webp").exists()]
    if tiles:
        sheet = Image.new("RGB", (960 * 2 + 10, (540 + 10) * ((len(tiles) + 1) // 2)), "#000")
        for i, t in enumerate(tiles):
            sheet.paste(t, ((i % 2) * 970, (i // 2) * 550))
        sheet.save(PREVIEW / "contact-landscape.png")
    tiles = [Image.open(OUT_IMG / f"{r['id']}-portrait-720.webp").convert("RGB").resize((360, 640), Image.LANCZOS)
             for r in regions if (OUT_IMG / f"{r['id']}-portrait-720.webp").exists()]
    if tiles:
        sheet = Image.new("RGB", (370 * len(tiles), 640), "#000")
        for i, t in enumerate(tiles):
            sheet.paste(t, (i * 370, 0))
        sheet.save(PREVIEW / "contact-portrait.png")
    tiles = [Image.open(OUT_IMG / f"{r['id']}-card.webp").convert("RGB") for r in regions
             if (OUT_IMG / f"{r['id']}-card.webp").exists()]
    if tiles:
        sheet = Image.new("RGB", (810 * 3, 510 * ((len(tiles) + 2) // 3)), "#000")
        for i, t in enumerate(tiles):
            sheet.paste(t, ((i % 3) * 810, (i // 3) * 510))
        sheet.save(PREVIEW / "contact-cards.png")


# ============================================================== main

def main():
    argv = dict(a.lstrip("-").split("=", 1) if "=" in a else (a.lstrip("-"), "1") for a in sys.argv[1:])
    only = set(argv.get("only", "heroes,data,og").split(","))
    want_regions = set(argv["regions"].split(",")) if "regions" in argv else None
    kinds = argv.get("frames", "landscape,portrait,card").split(",")
    t0 = time.time()
    for d in (RENDER, OUT_IMG, OUT_DATA, PREVIEW):
        d.mkdir(parents=True, exist_ok=True)

    log("regions:")
    regions = load_regions()
    base = geocode_base("street" if argv.get("base") == "street" else "address")
    base["m"] = merc(*base["lngLat"])
    log(f"base: {base['lngLat']} via {base['method']} ({base['matched']})")
    log("loading layers ...")
    L = Layers()

    if "data" in only:
        log("data:")
        facts = build_facts(L, regions, base)
        build_regions_map(L, regions, base, facts)

    jobs, encodes = [], []
    if "heroes" in only:
        log("hero pages:")
        for reg in regions:
            if want_regions and reg["id"] not in want_regions:
                continue
            for kind in kinds:
                t1 = time.time()
                html, F = build_region_page(L, reg, kind, base)
                hp = RENDER / f"{reg['id']}-{kind}.html"
                hp.write_text(html)
                png = RENDER / f"{reg['id']}-{kind}.png"
                jobs.append({"html": str(hp), "png": str(png), "w": F.W, "h": F.H,
                             "layout": str(RENDER / f"{reg['id']}-{kind}.labels.json")})
                for suffix, w, h, budget in OUTPUTS[kind]:
                    encodes.append((png, OUT_IMG / f"{reg['id']}{suffix}.webp", w, h, budget))
                log(f"  {reg['id']}-{kind}: {len(html) / 1e6:.1f} MB page in {time.time() - t1:.1f}s")
    og_png = None
    if "og" in only:
        job, og_png = build_og(L, regions, base)
        jobs.append(job)
    if jobs:
        log(f"rendering {len(jobs)} pages ...")
        run_renderer(jobs)
    if encodes:
        log("encoding webp ...")
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(4) as ex:
            for (png, out, w, h, budget), (q, size) in zip(
                    encodes, ex.map(lambda e: encode_webp(*e), encodes)):
                log(f"  {out.name:36s} q={q:2d} {size / 1000:6.1f} KB (budget {budget / 1000:.0f})")
        if "keep" in argv or "preview" in argv:
            PREVIEW.mkdir(parents=True, exist_ok=True)
            for png, *_ in {e[0]: e for e in encodes}.values():
                shutil.copy(png, PREVIEW / png.name)
        contact_sheets(regions)
    if og_png is not None:
        q, size = encode_og(og_png)
        log(f"  og.jpg q={q} {size / 1000:.1f} KB")
    log(f"done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()

