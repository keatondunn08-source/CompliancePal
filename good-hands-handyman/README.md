# GoodHands Handyman website (demo)

A static demo site for [GoodHands Handyman](https://goodhandshandyman.com.au/): Dan, a handyman based in Byron Bay who covers the Northern Rivers from Byron Bay to Tweed Heads. The hero plays three flyover films, one per area page on his current site (Byron Bay, Tweed Heads and Murwillumbah). Each film is rendered from real map data as a timber site model.

This is a **UI demo**. There's no backend: the job form checks the fields, then tells the visitor to call or text Dan instead of pretending something was sent.

```
good-hands-handyman/
├── site/                 ← the website (deploy this folder)
│   ├── index.html
│   ├── 404.html
│   └── assets/
│       ├── css/site.css
│       ├── js/site.js    ← flyover, tape-measure progress, sideways services track, coastal stories
│       ├── fonts/        ← Archivo + IBM Plex Mono (self-hosted, SIL OFL)
│       ├── img/          ← posters, favicon, share image
│       └── video/        ← flyover films (rendered by tools/flyover)
├── tools/flyover/        ← render pipeline for the hero films (not deployed)
└── netlify.toml
```

There is no build step.

## Preview locally

```bash
npx http-server site -p 8080 -c-1
# open http://localhost:8080
```

Use a server that supports HTTP range requests (http-server does; `python -m http.server` doesn't), or the videos won't seek and loop properly.

## Scroll behaviour

All of it lives in `assets/js/site.js`, driven by one rAF-throttled scroll handler.

| Effect | Where | Fallback |
|---|---|---|
| **Tape-measure progress bar.** A yellow blade under the header that extends as you scroll. | `initTape()`, `.tape` | Purely decorative (`aria-hidden`). |
| **Sheet over a pinned hero.** The hero is `position: sticky`. The rest of the page is one `.sheet` that slides up over it while the flyover dims. | `.hero`, `.sheet`, `initHeroCover()` | Works without JS. |
| **Sideways services track.** While the Services section is on screen, scrolling down moves the cards sideways, 1px for 1px. | `initHScroll()`, `.services.is-pinned` | Without JS, or with reduced motion, it's a swipeable row with snap points. |
| **Coastal stories.** The flyover still stays pinned and swaps to match whichever area story is mid-screen. | `initCoast()` | The first still stays on screen. |

The flyover pauses once the sheet covers it (an IntersectionObserver on the sheet, since a sticky hero never leaves the viewport on its own).

## Before launch: confirm these

The current site wasn't reachable from the build environment, so the content was gathered from search-engine copies of goodhandshandyman.com.au (home, Tweed Heads and Murwillumbah pages):

- [ ] **Phone and email:** 0481 457 271 and danhandywork@gmail.com.
- [ ] **Service list:** kitchen cabinets and doors, door hanging, locks and handles, deck restoration, gutters, fences, pergolas, custom carpentry, flooring, furniture assembly, holiday-rental maintenance and emergency repairs. Gutters only appeared in one search summary.
- [ ] **Response times:** same day for emergencies (when possible), quotes within 24 hours, general work within 48 hours. The Murwillumbah page says "same-week" for most jobs. Pick one promise and use it everywhere.
- [ ] **Reviews:** both quotes are from Dan's own site. The kitchen-door reviewer's name wasn't visible, so it's credited to "Tweed Heads customer". The second sentence of that review was cut off in the source.
- [ ] **Licence number and ABN:** NSW advertising for residential building work generally has to show the contractor licence number. Add it to the footer.
- [ ] **Logo:** the spirit-level mark is a placeholder.
- [ ] **Photos:** the old site has before/after gallery items (kitchen door, storm damage). Real job photos would do more for conversion than anything else on the page.
- [ ] **Job form:** connect it to a backend (e.g. Netlify Forms) and replace the demo message in `initForm()`.

Contact details are repeated in `index.html` (header, hero, areas, contact, footer, JSON-LD), `assets/js/site.js` (form message) and `404.html`. Search for `0481` and `danhandywork` to update them all.

## The flyover hero

The controller is the same one as the Addison Joinery site. It uses two crossfading `<video>` layers and picks a source per device: portrait on tall screens, otherwise 1080p or 720p, WebM with an MP4 fallback. It has a pause button and area tabs. With reduced motion or Save-Data it starts paused on a still poster.

| File | Used for |
|---|---|
| `video/<id>-1080.webm` / `.mp4` | large landscape screens |
| `video/<id>-720.webm` / `.mp4` | small landscape screens, slow connections |
| `video/<id>-portrait.webm` / `.mp4` | phones in portrait |
| `img/flyover/<id>.webp` / `<id>-portrait.webp` | hero posters (first frame) |
| `img/flyover/<id>-card.webp` | Coastal work stills (mid-flight frame, 800×500) |

## Re-rendering the films (`tools/flyover`)

Real building footprints, streets, parks, beaches and water come from **Overture Maps** (which includes OpenStreetMap). Terrain comes from the **Copernicus GLO-30 DEM**. Three.js renders each frame in headless Chromium, and ffmpeg encodes the outputs.

```bash
cd tools/flyover
npm install                      # three + playwright
pip install overturemaps pyarrow shapely numpy scipy rasterio imageio-ffmpeg

python3 fetch_overture.py        # ~4 min: map layers, one box per area → .cache/overture
mkdir -p .cache/dem && curl -o .cache/dem/cop30_S29_E153.tif \
  https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_S29_00_E153_00_DEM/Copernicus_DSM_COG_10_S29_00_E153_00_DEM.tif
python3 build_scenes.py          # seconds: one scene file per area → .cache/scenes

node render.mjs --preview        # stills at start / middle / end → .cache/preview
node render.mjs --fps=24         # full render + encode → site/assets/video, site/assets/img/flyover
```

Camera paths and sun direction are in `areas.json`. All three areas sit on one DEM tile (S29 E153). Northern Rivers towns are sparse, so a 1080p frame renders in about 3 s on 4 vCPUs (SwiftShader). That's roughly 10–15 minutes per area, including the portrait version and encoding.

## Data credits (required, already in the footer)

- Map data © OpenStreetMap contributors and the Overture Maps Foundation, ODbL / CDLA-Permissive-2.0.
- Copernicus DEM GLO-30 © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA.
- Fonts: Archivo and IBM Plex Mono, SIL Open Font License 1.1.
