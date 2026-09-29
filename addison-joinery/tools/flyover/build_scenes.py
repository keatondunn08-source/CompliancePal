#!/usr/bin/env python3
"""Turn the cached open map data into one render-ready scene per service area.

Inputs  .cache/overture/*.geojson   (fetch_overture.py)
        .cache/dem/cop30_S34_E151.tif (Copernicus GLO-30 DEM, see README)
Output  .cache/scenes/<area-id>.json

All output geometry is in local metres around the area centre: x east, y north.
Terrain is represented the way an architectural site model is built: stacked
contour layers of a fixed thickness, with water cut out below the land.
"""
import json
import math
import sys
import time
from pathlib import Path

import numpy as np
import rasterio
import shapely
from rasterio import features as rfeatures
from rasterio.transform import Affine
from rasterio.windows import from_bounds
from scipy import ndimage
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box, shape
from shapely.ops import unary_union
from shapely.prepared import prep
from shapely.strtree import STRtree

HERE = Path(__file__).parent
CACHE = HERE / ".cache"
OUT = CACHE / "scenes"
DEM_PATH = CACHE / "dem" / "cop30_S34_E151.tif"
CONFIG = json.loads((HERE / "areas.json").read_text())

EXTENT = float(CONFIG["extent"])
HALF = EXTENT / 2
STEP = float(CONFIG["terrain"]["step"])           # contour interval (real m)
EXAG = float(CONFIG["terrain"]["exaggeration"])   # terrain vertical exaggeration
LAYER = STEP * EXAG                               # rendered layer thickness
WATER_Y = float(CONFIG["waterY"])
GRID = 10.0                                       # terrain grid (m)

WATER_SUBTYPES = {"ocean", "water", "river", "lake", "reservoir", "canal", "pond", "stream"}
POOL_CLASSES = {"swimming_pool", "reflecting_pool"}

TEX_CLASSES = {
    # land_use (subtype, class) and land (subtype, class) -> texture layer
    "park": {
        ("park", None), ("recreation", "pitch"), ("recreation", "playground"),
        ("recreation", "recreation_ground"), ("recreation", "track"), ("managed", "grass"),
        ("horticulture", None), ("golf", "golf_course"), ("golf", "fairway"), ("golf", "tee"),
        ("golf", "green"), ("golf", "rough"), ("cemetery", None), ("protected", None),
        ("grass", None),
    },
    "bush": {("forest", None), ("shrub", None), ("wetland", None)},
    "sand": {("sand", None), ("golf", "bunker")},
    "rock": {("rock", None)},
    "plaza": {("pedestrian", None)},
    "rail": {("transportation", "railway")},
}

ROAD_STYLE = {
    # class -> (width m, style) ; style 0 major, 1 local, 2 minor, 3 path
    "motorway": (24, 0), "trunk": (20, 0), "primary": (16, 0), "secondary": (13, 0),
    "tertiary": (11, 1), "residential": (8.5, 1), "unclassified": (8, 1),
    "living_street": (6, 1), "unknown": (6, 2), "service": (4.5, 2), "pedestrian": (5, 2),
    "footway": (2.2, 3), "path": (2.2, 3), "cycleway": (2.5, 3), "steps": (2.2, 3),
}
BRIDGE_CLASSES = {"motorway", "trunk", "primary", "secondary", "tertiary", "residential",
                  "unclassified", "pedestrian", "footway"}


def log(*a):
    print(*a, flush=True)


# ---------------------------------------------------------------- loading

def load_layer(name):
    t = time.time()
    feats = json.loads((CACHE / "overture" / f"{name}.geojson").read_text())["features"]
    geoms = shapely.from_geojson([json.dumps(f["geometry"]) for f in feats])
    props = [f["properties"] for f in feats]
    log(f"  loaded {name}: {len(feats)} in {time.time() - t:.1f}s")
    return geoms, props, STRtree(geoms)


def query(layer, lonlat_box):
    geoms, props, tree = layer
    idx = tree.query(lonlat_box)
    return [(geoms[i], props[i]) for i in sorted(idx)]


def class_matches(table, subtype, cls):
    return (subtype, cls) in table or (subtype, None) in table


# ---------------------------------------------------------------- geometry helpers

def iter_polys(g):
    if g is None or g.is_empty:
        return
    if isinstance(g, Polygon):
        yield g
    elif hasattr(g, "geoms"):
        for sub in g.geoms:
            yield from iter_polys(sub)


def iter_lines(g):
    if g is None or g.is_empty:
        return
    if isinstance(g, LineString):
        yield g
    elif hasattr(g, "geoms"):
        for sub in g.geoms:
            yield from iter_lines(sub)


def chaikin_ring(coords, iters):
    pts = np.asarray(coords, dtype=np.float64)[:-1]
    if len(pts) < 3:
        return None
    for _ in range(iters):
        nxt = np.roll(pts, -1, axis=0)
        out = np.empty((len(pts) * 2, 2))
        out[0::2] = 0.75 * pts + 0.25 * nxt
        out[1::2] = 0.25 * pts + 0.75 * nxt
        pts = out
    return np.vstack([pts, pts[:1]])


def smooth(g, iters=3):
    polys = []
    for p in iter_polys(g):
        ext = chaikin_ring(p.exterior.coords, iters)
        if ext is None:
            continue
        holes = [h for h in (chaikin_ring(r.coords, iters) for r in p.interiors) if h is not None]
        polys.append(Polygon(ext, holes))
    if not polys:
        return Polygon()
    return shapely.make_valid(MultiPolygon(polys))


def flat(coords, nd=1):
    arr = np.round(np.asarray(coords)[:-1, :2], nd)
    return arr.ravel().tolist()


def encode_polys(g, min_area, simplify=None, min_hole=0.0):
    out = []
    for p in iter_polys(g):
        if simplify:
            p = p.simplify(simplify, preserve_topology=True)
        if p.is_empty or p.area < min_area or not isinstance(p, Polygon):
            continue
        rings = [flat(p.exterior.coords)]
        rings += [flat(h.coords) for h in p.interiors if Polygon(h).area >= min_hole]
        if len(rings[0]) >= 6:
            out.append(rings)
    return out


def seeded(x, y):
    """Deterministic 0..1 value from a position (stable across runs)."""
    v = math.sin(x * 12.9898 + y * 78.233) * 43758.5453
    return v - math.floor(v)


# ---------------------------------------------------------------- per-area build

class Area:
    def __init__(self, cfg):
        self.cfg = cfg
        (lon_a, lat_a), (lon_b, lat_b) = cfg["camera"]["path"]
        mid_lon, mid_lat = (lon_a + lon_b) / 2, (lat_a + lat_b) / 2
        self.kx = 111320.0 * math.cos(math.radians(mid_lat))
        self.ky = 110574.0
        # Heading = compass bearing of the path, turned by yaw (+ = clockwise).
        dx, dy = (lon_b - lon_a) * self.kx, (lat_b - lat_a) * self.ky
        heading = math.atan2(dx, dy) + math.radians(cfg["camera"].get("yaw", 0))
        self.fwd = (math.sin(heading), math.cos(heading))
        # Centre the model a little ahead of the path, where the camera looks.
        self.lon0 = mid_lon + self.fwd[0] * 350 / self.kx
        self.lat0 = mid_lat + self.fwd[1] * 350 / self.ky
        m = 1.1  # fetch margin
        self.lonlat_box = box(self.lon0 - HALF * m / self.kx, self.lat0 - HALF * m / self.ky,
                              self.lon0 + HALF * m / self.kx, self.lat0 + HALF * m / self.ky)
        self.extent_box = box(-HALF, -HALF, HALF, HALF)

    def to_local(self, g):
        lon0, lat0, kx, ky = self.lon0, self.lat0, self.kx, self.ky
        return shapely.transform(g, lambda c: np.column_stack(((c[:, 0] - lon0) * kx, (c[:, 1] - lat0) * ky)))

    def pt(self, lon, lat):
        return ((lon - self.lon0) * self.kx, (lat - self.lat0) * self.ky)

    # -- terrain ------------------------------------------------------------
    def build_elevation(self):
        with rasterio.open(DEM_PATH) as src:
            b = self.lonlat_box.bounds
            win = from_bounds(b[0] - 0.01, b[1] - 0.01, b[2] + 0.01, b[3] + 0.01, src.transform)
            dem = src.read(1, window=win, boundless=True, fill_value=0).astype(np.float32)
            wt = src.window_transform(win)
        # GLO-30 is a surface model: open with a ~150 m window to strip
        # buildings and tree canopy, then soften for model-like contours.
        dem = ndimage.grey_opening(dem, size=(5, 5))
        dem = ndimage.gaussian_filter(dem, 1.3)
        n = int(EXTENT / GRID) + 1
        xs = np.linspace(-HALF, HALF, n)
        ys = np.linspace(HALF, -HALF, n)  # row 0 = north
        X, Y = np.meshgrid(xs, ys)
        lon = self.lon0 + X / self.kx
        lat = self.lat0 + Y / self.ky
        col = (lon - wt.c) / wt.a - 0.5
        row = (lat - wt.f) / wt.e - 0.5
        self.elev = ndimage.map_coordinates(dem, [row, col], order=1, mode="nearest")
        self.grid_n = n
        self.grid_tf = Affine(GRID, 0, -HALF - GRID / 2, 0, -GRID, HALF + GRID / 2)

    def elev_at(self, x, y):
        c = (x + HALF) / GRID
        r = (HALF - y) / GRID
        return float(ndimage.map_coordinates(self.elev, [[r], [c]], order=1, mode="nearest")[0])

    def top_at(self, x, y):
        """Rendered height of the terrain surface (stepped) at a point."""
        k = max(0, int(math.floor(self.elev_at(x, y) / STEP + 0.5)))
        return k * LAYER

    # -- build ----------------------------------------------------------------
    def build(self, L):
        cfg = self.cfg
        log(f"== {cfg['id']}  centre {self.lon0:.4f},{self.lat0:.4f}")
        t0 = time.time()
        self.build_elevation()

        # water / land ---------------------------------------------------------
        water_parts, pools = [], []
        for g, p in query(L["water"], self.lonlat_box):
            if g.geom_type not in ("Polygon", "MultiPolygon"):
                continue
            if p.get("subtype") in WATER_SUBTYPES:
                water_parts.append(self.to_local(g))
            elif p.get("class") in POOL_CLASSES:
                pools.append(self.to_local(g))
        water = unary_union(water_parts).intersection(self.extent_box).buffer(0)
        land = self.extent_box.difference(water)
        land = unary_union([p for p in iter_polys(land) if p.area > 400]).buffer(0)
        log(f"  land {land.area / 1e6:.2f} km2, water {water.area / 1e6:.2f} km2")

        # stacked contour layers ----------------------------------------------
        elev = np.where(
            rfeatures.rasterize([(land, 1)], out_shape=self.elev.shape, transform=self.grid_tf) > 0,
            self.elev, 0.0)
        self.elev = np.maximum(self.elev, 0.0)
        layers = [{"k": 0, "polys": encode_polys(land, 300, simplify=0.6, min_hole=300)}]
        kmax = int(math.floor(float(elev.max()) / STEP + 0.5))
        for k in range(1, kmax + 1):
            mask = elev >= (k - 0.5) * STEP
            shapes = [shape(s) for s, v in rfeatures.shapes(mask.astype(np.uint8), mask=mask,
                                                            transform=self.grid_tf) if v == 1]
            if not shapes:
                break
            g = unary_union(shapes).simplify(GRID * 0.7)
            g = smooth(g, 3).intersection(land).buffer(0)
            polys = encode_polys(g, 900, simplify=0.8, min_hole=900)
            if polys:
                layers.append({"k": k, "polys": polys})
        log(f"  terrain: {len(layers)} layers (max elev {float(elev.max()):.0f} m)")

        # buildings ------------------------------------------------------------
        land_prep = prep(land)
        buildings = []
        for g, p in query(L["building"], self.lonlat_box):
            g = self.to_local(g)
            for poly in iter_polys(g):
                if not poly.intersects(self.extent_box):
                    continue
                poly = poly.simplify(0.35, preserve_topology=True)
                if poly.is_empty or poly.area < 16:
                    continue
                c = poly.representative_point()
                r = seeded(c.x, c.y)
                h = building_height(p, poly.area, r)
                if land_prep.contains(c):
                    base = self.top_at(c.x, c.y)
                    z0, z1 = base - 1.5, base + h
                else:  # wharves, marinas, piers
                    z0, z1 = WATER_Y, h
                rings = [flat(poly.exterior.coords)]
                rings += [flat(i.coords) for i in poly.interiors if Polygon(i).area > 120]
                buildings.append([round(z0, 1), round(z1, 1), *rings])
        log(f"  buildings: {len(buildings)}")

        # roads + bridges ------------------------------------------------------
        roads, bridges = [], []
        water_prep = prep(water)
        for g, p in query(L["segment"], self.lonlat_box):
            sub, cls = p.get("subtype"), p.get("class")
            if sub == "rail":
                if cls in ("subway",):
                    continue
                w, style = (5.0, 4) if cls == "light_rail" else (7.0, 4)
            elif sub == "road" and cls in ROAD_STYLE:
                w, style = ROAD_STYLE[cls]
            else:
                continue
            g = self.to_local(g).intersection(self.extent_box)
            for line in iter_lines(g):
                if line.length < 2:
                    continue
                roads.append([w, style, flat(np.vstack([line.coords, line.coords[-1:]]))])
                if (cls in BRIDGE_CLASSES or sub == "rail") and water_prep.intersects(line):
                    over = line.intersection(water)
                    for part in iter_lines(over):
                        if part.length < 25:
                            continue
                        # extend onto the shore so decks land cleanly
                        ext = extend_line(part, 18)
                        bridges.append([max(w, 6.0), 7.0, flat(np.vstack([ext.coords, ext.coords[-1:]]))])
        log(f"  roads: {len(roads)}, bridges: {len(bridges)}")

        # texture layers -------------------------------------------------------
        tex = {k: [] for k in TEX_CLASSES}
        for lname in ("land_use", "land"):
            for g, p in query(L[lname], self.lonlat_box):
                if g.geom_type not in ("Polygon", "MultiPolygon"):
                    continue
                sub, cls = p.get("subtype"), p.get("class")
                for key, table in TEX_CLASSES.items():
                    if class_matches(table, sub, cls):
                        tex[key].append(self.to_local(g))
                        break
        tex_out = {}
        for key, parts in tex.items():
            g = unary_union(parts).intersection(self.extent_box) if parts else Polygon()
            tex_out[key] = encode_polys(g, 30, simplify=0.8, min_hole=30)
        pool_g = unary_union(pools).intersection(self.extent_box) if pools else Polygon()
        tex_out["pool"] = encode_polys(pool_g, 6, simplify=0.3)
        log("  texture: " + ", ".join(f"{k}={len(v)}" for k, v in tex_out.items()))

        # trees ----------------------------------------------------------------
        trees = []
        for g, p in query(L["land"], self.lonlat_box):
            if p.get("subtype") != "tree":
                continue
            g = self.to_local(g)
            if g.geom_type == "Point":
                pts = [g]
            else:
                pts = [line.interpolate(d) for line in iter_lines(g)
                       for d in np.arange(0, line.length, 9.0)]
            for q in pts:
                if abs(q.x) < HALF and abs(q.y) < HALF and land_prep.contains(q):
                    trees.append((q.x, q.y, 3.2 + seeded(q.x, q.y) * 2.2))
        rng = np.random.default_rng(7)
        for poly in iter_polys(unary_union(tex["bush"]).intersection(land) if tex["bush"] else None):
            n = int(poly.area / 170)
            if n <= 0:
                continue
            minx, miny, maxx, maxy = poly.bounds
            cand = rng.uniform((minx, miny), (maxx, maxy), size=(n * 3, 2))
            inside = shapely.contains_xy(poly, cand[:, 0], cand[:, 1])
            for x, y in cand[inside][:n]:
                trees.append((float(x), float(y), 3.8 + seeded(x, y) * 2.6))
        if len(trees) > 60000:
            keep = rng.choice(len(trees), 60000, replace=False)
            trees = [trees[i] for i in sorted(keep)]
        tree_flat = []
        for x, y, r in trees:
            tree_flat += [round(x, 1), round(y, 1), round(self.top_at(x, y), 1), round(r, 1)]
        log(f"  trees: {len(trees)}")

        # camera ---------------------------------------------------------------
        cam = cfg["camera"]
        def ground(v):  # world coords (x, y-up, z-south) of a lon/lat on the model
            x, y = self.pt(v[0], v[1])
            return [round(x, 1), round(self.top_at(x, y), 1), round(-y, 1)]
        camera = {
            "path": [ground(cam["path"][0]), ground(cam["path"][1])],
            "forward": [round(self.fwd[0], 5), 0, round(-self.fwd[1], 5)],
            "pitch": cam["pitch"], "dist": cam["dist"],
        }

        scene = {
            "id": cfg["id"], "name": cfg["name"], "center": [self.lon0, self.lat0],
            "extent": EXTENT, "layer": LAYER, "waterY": WATER_Y,
            "layers": layers, "buildings": buildings, "roads": roads, "bridges": bridges,
            "tex": tex_out, "trees": tree_flat, "camera": camera, "sun": cfg.get("sun"),
        }
        OUT.mkdir(parents=True, exist_ok=True)
        dest = OUT / f"{cfg['id']}.json"
        dest.write_text(json.dumps(scene, separators=(",", ":")))
        log(f"  wrote {dest.name} ({dest.stat().st_size / 1e6:.1f} MB) in {time.time() - t0:.0f}s")


def building_height(p, area, r):
    h = p.get("height")
    if h and h > 1.5:
        return float(h)
    f = p.get("num_floors")
    if f and f > 0:
        return f * 3.2 + 1.2
    cls = p.get("class") or ""
    if cls in ("garage", "garages", "shed", "carport", "roof", "shelter", "hut", "kiosk", "toilets",
               "service", "bunker", "cabin", "storage_tank", "transformer_tower", "boathouse"):
        return 2.6 + r * 1.4
    if cls in ("house", "detached", "semidetached_house", "terrace", "bungalow", "residential"):
        return 6.0 + r * 3.5
    if cls == "apartments":
        return 12.0 + r * 10.0
    if cls in ("commercial", "retail", "office", "industrial", "warehouse", "hospital", "school",
               "university", "college", "civic", "public", "church", "hotel", "government"):
        return 8.0 + r * 7.0
    if area < 45:
        return 3.0 + r * 1.5
    if area < 300:
        return 6.0 + r * 3.5
    if area < 1200:
        return 9.0 + r * 5.0
    return 11.0 + r * 7.0


def extend_line(line, d):
    c = np.asarray(line.coords)
    a, b = c[0], c[1]
    y, z = c[-1], c[-2]
    va = (a - b) / (np.linalg.norm(a - b) or 1)
    vb = (y - z) / (np.linalg.norm(y - z) or 1)
    return LineString(np.vstack([a + va * d, c, y + vb * d]))


def main():
    only = set(sys.argv[1:])
    log("loading layers...")
    L = {name: load_layer(name) for name in ("water", "building", "segment", "land_use", "land")}
    for cfg in CONFIG["areas"]:
        if only and cfg["id"] not in only:
            continue
        Area(cfg).build(L)


if __name__ == "__main__":
    main()
