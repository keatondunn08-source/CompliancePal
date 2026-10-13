# Service-area maps

Builds the night-map hero stills, region cards, the Open Graph image and the region
geometry/facts JSON for the Corporate Cleaning Solutions site, from open map data.

| Output | Path |
| --- | --- |
| Hero stills, 16:9 | `site/assets/img/map/<id>-{960,1440,1920,2560}.webp` |
| Hero stills, 9:16 | `site/assets/img/map/<id>-portrait-{720,1080}.webp` |
| Region cards (16:10) | `site/assets/img/map/<id>-card.webp` (800×500), `<id>-card-1200.webp` |
| Open Graph image | `site/assets/img/og.jpg` (1200×630) |
| Interactive map geometry | `tools/build/data/regions-map.json` |
| Region facts | `tools/build/data/region-facts.json` |

Region ids: `cbd-valley`, `southside`, `south-brisbane`, `western-suburbs`, `northside`, `eastside`.

## Commands

Run from this directory (`tools/maps`). Tested with Python 3.13, Node 22 and ffmpeg 6.1 (built with libwebp).

```sh
pip install overturemaps pyarrow shapely   # numpy and Pillow are assumed present
npm install                                # playwright-core only (no browser download)
python3 fetch.py                           # Overture -> .cache/overture/*.parquet (about 40 s, 75 MB)
python3 build_maps.py                      # every output (about 4 min on 4 vCPU)
```

The renderer uses an existing Chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
Set `CHROME=/path/to/chrome` to use a different one. Never run `playwright install`.

Partial builds:

```sh
python3 build_maps.py --only=data                    # regions-map.json + region-facts.json (about 10 s)
python3 build_maps.py --only=heroes --regions=southside --frames=landscape,portrait
python3 build_maps.py --only=og
python3 build_maps.py --keep                         # also copy the PNG masters to .cache/preview/
python3 build_maps.py --base=street                  # geocode the base from the Bracken St midpoint
python3 fetch.py --force building                    # re-download one layer
```

Each build also writes previews to `.cache/preview/`: `contact-landscape.png`, `contact-portrait.png`,
`contact-cards.png` and `regions-map-preview.png`/`.svg` (a light-theme drawing of `regions-map.json`).

## How it works

1. **`fetch.py`** reads the public Overture bucket on S3 directly (release pinned in `common.py`;
   no STAC host needed). It fetches suburb polygons (`divisions/division_area`, AU localities and
   neighbourhoods) and Moorooka addresses first. It then works out the union of every frame the
   build renders and fetches roads and rail, water, land use, land and buildings for that box.
2. **`build_maps.py`**:
   - Unions each region's suburbs (Web Mercator, hairline gaps closed).
   - Geocodes the base.
   - Writes an SVG page per frame (shapely, projected to pixels) and rasterises it with headless
     Chromium (`render.mjs`, which also places the labels).
   - Downscales with ffmpeg Lanczos and encodes WebP. A binary search finds the highest quality
     (capped at 86) that fits each byte budget.
3. **`common.py`** holds the release, the region and suburb lists, the name aliases, and the frame
   rules. **`build_maps.py`** holds the palette (`C`), line widths (`ROAD_STYLE`), per-frame
   scaling (`KIND_STYLE`) and the byte budgets (`OUTPUTS`).

### Framing

| Frame | Master | Region bbox fit | Centroid at | Labels |
| --- | --- | --- | --- | --- |
| landscape | 2560×1440 | 42% of width, at most 60% of height | x 70%, y 38% | none in x<58% and y>30% |
| portrait | 1080×1920 | 78% of width, at most 40% of height | x 50%, y 27% | none in y>45% |
| card | 1200×750 | 70% of width, at most 80% of height | centred | anywhere |

If the centroid position would push the region bbox past a 4% frame margin, the frame shifts to keep
the region inside. In the text zones (where the site headline sits), label candidates are dropped and
the label layout rejects any label box that touches the zone. A suburb with no clear spot is left
unlabelled rather than forced. The base marker is hidden when it would fall in the zone or within 5%
of the frame edge.

### Styling notes

Line widths are specified at 1920 px wide and scaled with the frame width:

- landscape: ×2560/1920
- portrait: ×1080/1920×1.35
- card: ×1200/1920×1.3
- OG: rendered at 2400×1260, ×1.375, then downscaled

Labels are 1.05% of the width in landscape. They are 2.1% in portrait and 1.9% on cards, because
1.05% would be about 4 CSS px on a phone. Labels have a thin background-coloured halo.

Other details:

- Tunnels (Clem7, Legacy Way, Airport Link) are drawn dashed and faint.
- Rail in tunnels or under construction is omitted.
- Suburb boundaries inside a region are faint dashes.
- The OG image uses a heavier region outline and deeper outside dimming, so the six regions read at
  that zoom.

## Data definitions

- **Suburb matching** is by exact Overture `names.primary`, with aliases in `common.py`.
  - The CBD is "Brisbane City" (`locality`).
  - Woolloongabba is a `macrohood`.
  - All 31 suburbs match.
- **Base**: 19 Bracken Street, Moorooka from the Overture `addresses` theme
  (`method: "overture-address"`). If that is missing, or with `--base=street`, it is the midpoint of
  Bracken Street within Moorooka from Overture transportation segments (`"street-midpoint"`).
- **`buildingCount`**: Overture footprints (not underground) whose centroid lies inside the region.
- **`kmFromBase`**: haversine distance from the base to the region's area-weighted centroid
  (computed in an equal-area projection).
- **`areaKm2`**: WGS84 cylindrical equal-area area of the suburb union.
- **`riverFrontageKm`**: length of the region boundary within 50 m of the polygons named
  "Brisbane River". Suburb boundaries follow the river centreline, so a river reach counts for the
  regions on both banks.
- **`regions-map.json`** uses Web Mercator, scaled to 1000 units wide. The frame is the union of the
  six regions plus 8% padding.
  - Suburbs share simplified arcs, so suburb and region outlines meet without slivers.
  - Path data is an absolute `M` followed by relative `l` commands, rounded to 0.1. Polygons close
    with `z`.
  - `water` is water polygons only.
  - `roads` is motorway, trunk and primary, without links or tunnels. Dual carriageways are merged
    into one stroke.
  - Simplification steps up automatically until the file is under 45 KB.

## Data credits

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, licensed under the
[ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Distributed by the
[Overture Maps Foundation](https://overturemaps.org/) (release 2026-09-23.1) under ODbL 1.0 /
[CDLA-Permissive-2.0](https://cdla.dev/permissive-2-0/).

Overture's buildings include Microsoft ML Buildings (ODbL 1.0). Some division data is from Esri
Community Maps (CC0 1.0).

The base coordinate is from Overture's `addresses` theme. Its Australian source (`au/countrywide`)
is tagged `LicenseRef-Proprietary` in the Overture metadata. Only that one point, the business's own
premises, is used. Use `--base=street` for an OSM-only coordinate.

Suggested on-site attribution: "Map data © OpenStreetMap contributors, Overture Maps Foundation."
`regions-map.json` carries the full string in `credits`.
