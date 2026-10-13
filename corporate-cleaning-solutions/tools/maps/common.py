"""Shared configuration and helpers for the map pipeline (fetch.py, build_maps.py)."""
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent.parent
CACHE = HERE / ".cache"
OVERTURE = CACHE / "overture"

RELEASE = "2026-09-23.1"

# Wide box used for the division (suburb) polygons. The heavy layers are fetched
# for the union of every rendered frame, computed from these polygons by fetch.py.
DIVISION_BBOX = (152.80, -27.80, 153.25, -27.25)
# Moorooka, for the address lookup.
ADDRESS_BBOX = (153.010, -27.550, 153.040, -27.525)

BASE_ADDRESS = {"number": "19", "street": "Bracken Street", "suburb": "Moorooka", "postcode": "4105"}

REGIONS = [
    {"id": "cbd-valley", "name": "CBD & Valley",
     "suburbs": ["Brisbane City", "Spring Hill", "Fortitude Valley", "Newstead", "Bowen Hills"]},
    {"id": "southside", "name": "Southside",
     "suburbs": ["Moorooka", "Annerley", "Yeronga", "Tarragindi", "Salisbury", "Rocklea"]},
    {"id": "south-brisbane", "name": "South Brisbane & Gabba",
     "suburbs": ["South Brisbane", "West End", "Highgate Hill", "Woolloongabba", "Kangaroo Point"]},
    {"id": "western-suburbs", "name": "Western Suburbs",
     "suburbs": ["Toowong", "Auchenflower", "St Lucia", "Taringa", "Indooroopilly"]},
    {"id": "northside", "name": "Northside",
     "suburbs": ["Albion", "Ascot", "Hamilton", "Clayfield", "Hendra"]},
    {"id": "eastside", "name": "Eastside",
     "suburbs": ["East Brisbane", "Coorparoo", "Greenslopes", "Camp Hill", "Carina"]},
]

# Alternative spellings Overture/OSM may use for a wanted suburb name.
ALIASES = {
    "Brisbane City": ["Brisbane City", "Brisbane CBD", "Brisbane Central", "Brisbane"],
    "St Lucia": ["St Lucia", "Saint Lucia", "St. Lucia"],
}

# Frame definitions (pixel size of the rendered master, framing rule).
#   fit:  region bbox fills this fraction of the frame width ...
#   maxh: ... but never more than this fraction of the frame height
#   at:   where the region centroid sits (fractions of width, height)
#   text_zone: (x0, y0, x1, y1) fractions where the site's headline sits; no suburb
#              label (or base marker) is drawn there.
FRAMES = {
    "landscape": {"w": 2560, "h": 1440, "fit": 0.42, "maxh": 0.60, "at": (0.70, 0.38),
                  "text_zone": (0.0, 0.30, 0.58, 1.0)},
    "portrait": {"w": 1080, "h": 1920, "fit": 0.78, "maxh": 0.40, "at": (0.50, 0.27),
                 "text_zone": (0.0, 0.45, 1.0, 1.0)},
    "card": {"w": 1200, "h": 750, "fit": 0.70, "maxh": 0.80, "at": (0.50, 0.50)},
}

R_MERC = 6378137.0


def merc(lon, lat):
    """Web Mercator metres (EPSG:3857)."""
    x = math.radians(lon) * R_MERC
    y = math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R_MERC
    return x, y


def unmerc(x, y):
    lon = math.degrees(x / R_MERC)
    lat = math.degrees(2 * math.atan(math.exp(y / R_MERC)) - math.pi / 2)
    return lon, lat


def haversine_km(a, b):
    lon1, lat1, lon2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * 6371.0088 * math.asin(math.sqrt(h))


def frame_box(bounds_merc, centroid_merc, frame):
    """Return (minx, miny, maxx, maxy) in Mercator metres for a framing rule.

    bounds_merc: region bbox in Mercator metres; centroid_merc: (x, y).
    """
    minx, miny, maxx, maxy = bounds_merc
    bw, bh = maxx - minx, maxy - miny
    W, H = frame["w"], frame["h"]
    scale = min(frame["fit"] * W / bw, frame["maxh"] * H / bh)  # px per metre
    fx, fy = frame["at"]
    cx, cy = centroid_merc
    # keep the whole region bbox inside the frame with a 4% margin
    left = cx - fx * W / scale
    top = cy + fy * H / scale
    m = 0.04
    if minx < left + m * W / scale:
        left = minx - m * W / scale
    if maxx > left + (1 - m) * W / scale:
        left = maxx - (1 - m) * W / scale
    if maxy > top - m * H / scale:
        top = maxy + m * H / scale
    if miny < top - (1 - m) * H / scale:
        top = miny + (1 - m) * H / scale
    return (left, top - H / scale, left + W / scale, top), scale


def read_json(path):
    return json.loads(Path(path).read_text())
