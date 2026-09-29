# Addison Joinery website

A static marketing site for [Addison Joinery](https://addisonjoinery.com.au/), a Sydney joinery and shopfitting business based in St Peters. The hero is a sequence of five flyover films, one per service area. Each film is rendered from real map data as a CNC-cut timber site model.

```
addison-joinery/
├── site/                 ← the website (deploy this folder)
│   ├── index.html
│   ├── thank-you/        ← form success page (no-JS fallback)
│   ├── 404.html
│   └── assets/
│       ├── css/site.css
│       ├── js/site.js    ← flyover controller, nav, enquiry form
│       ├── fonts/        ← Fraunces + Inter (self-hosted, SIL OFL)
│       ├── img/          ← posters, favicon, share image
│       └── video/        ← flyover films (rendered by tools/flyover)
├── tools/flyover/        ← render pipeline for the hero films (not deployed)
└── netlify.toml
```

There is no build step. Edit the HTML/CSS/JS and deploy.

## Preview locally

```bash
npx http-server site -p 8080 -c-1
# open http://localhost:8080
```

Use a server that supports HTTP range requests (http-server does; `python -m http.server` doesn't), or the videos won't seek and loop properly.

## Deploy (Netlify)

1. New site from Git, pointing at this repository.
2. **Base directory:** `addison-joinery`. `netlify.toml` sets the publish directory to `site`.
3. Enquiries arrive through **Netlify Forms** (form name `enquiry`). New sites have to **enable form detection** first (*Forms → Enable form detection*), then redeploy. Turn on email notifications under *Forms → Notifications*, and send a test enquiry before launch.

The config also sets security headers (CSP included) and long cache lifetimes for video, fonts and images.

Any static host works, but the enquiry form then needs another backend. Without one, it shows an error that points people to the phone number and email instead.

## Before launch: confirm these

I (Claude) couldn't reach the current website from the build environment. The content below was gathered from public listings and needs checking:

- [ ] **Address:** the site says *493–495 Princes Highway, St Peters NSW 2044*. Yelp/Yellow Pages still list *358 Princes Hwy*.
- [ ] **Phone numbers:** 0424 186 855 (mobile) and (02) 9557 8968 (landline, from directories; may be out of date).
- [ ] **Email:** danielle@addisonjoinery.com.au is a personal inbox. Consider a shared address such as `info@`.
- [ ] **Service areas:** the five flyover areas are inferred from "Sydney's prominent waterfront suburbs" plus a CBD commercial focus. Swap them for the areas you actually want to win work in.
- [ ] **Licence number and ABN:** in NSW, residential building work (including kitchen and wardrobe installs over the Fair Trading threshold) generally requires the contractor licence number in advertising. Add it to the footer, next to the ABN.
- [ ] **Logo:** the "A" mark and wordmark are placeholders. Replace them with the real logo (header, footer, favicon, `og.jpg`).
- [ ] **Project photography:** the site has no portfolio images yet, only a link to Instagram. Real kitchen and fitout photos will do more for conversion than anything else on this page.

Contact details are repeated in `index.html` (header, contact section, footer, JSON-LD), `assets/js/site.js` (form error message) and `thank-you/index.html`. Search for `0424` and `danielle@` to update them all.

## The flyover hero

`assets/js/site.js` → `initFlyover()`:

- **Two `<video>` layers.** One plays while the other preloads the next area, then they crossfade. No more than two clips are ever decoded at once, which matters on phones.
- **Source per device:** portrait 720×1280 on tall screens, otherwise 1080p or 720p depending on screen size and connection. WebM/VP9 is used where supported, with MP4/H.264 as the fallback.
- **Pausing:** plays only while the hero is on screen and the tab is visible. It has a pause button (WCAG 2.2.2) and area tabs to jump between films.
- **Reduced motion and Save-Data:** the hero starts paused on a still poster. The poster `<img>` is also the LCP element, so the page renders fast before any video loads.

File naming (per area id, e.g. `eastern-suburbs`):

| File | Used for |
|---|---|
| `video/<id>-1080.webm` / `.mp4` | large landscape screens |
| `video/<id>-720.webm` / `.mp4` | small landscape screens, slow connections |
| `video/<id>-portrait.webm` / `.mp4` | phones in portrait |
| `img/flyover/<id>.webp` / `<id>-portrait.webp` | hero posters (first frame) |
| `img/flyover/<id>-card.webp` | Areas section cards (mid-flight frame, 800×500) |

**Swapping in real drone footage later:** export 7–10 s muted clips at the sizes above with the same filenames. The controller doesn't care what's in them. (Commercial drone work needs a CASA-certified operator, and much of inner Sydney is controlled airspace.)

**Adding or changing an area:** add it to `tools/flyover/areas.json`, render it, then add a matching `<button class="flyover__tab">` in the hero and a card in the Areas section of `index.html`.

## Re-rendering the films (`tools/flyover`)

The films are rendered, not filmed. Real building footprints, heights, streets, parks, beaches and water come from **Overture Maps** (which includes OpenStreetMap). Terrain comes from the **Copernicus GLO-30 DEM** and is rebuilt as stacked contour layers, like an architect's site model. Three.js renders each frame in headless Chromium, and ffmpeg encodes the web versions.

```bash
cd tools/flyover
npm install                      # three + playwright
pip install overturemaps pyarrow shapely numpy scipy rasterio imageio-ffmpeg

python3 fetch_overture.py        # ~2 min: map layers for the region → .cache/overture
curl -o .cache/dem/cop30_S34_E151.tif \
  https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_S34_00_E151_00_DEM/Copernicus_DSM_COG_10_S34_00_E151_00_DEM.tif
python3 build_scenes.py          # ~1 min: one scene file per area → .cache/scenes

node render.mjs --preview        # stills at start / middle / end → .cache/preview
node render.mjs                  # full render + encode → site/assets/video, site/assets/img/flyover
node render.mjs --encode-only    # re-encode from the cached masters (e.g. to change quality)
```

Camera paths, sun direction, contour interval and vertical exaggeration are all in `areas.json`. Look and lighting live in `scene.js`.

Rendering uses SwiftShader (software WebGL), so it runs on any machine but slowly. On 4 vCPUs expect about 4.5 s per 1080p frame, roughly 1½–2 hours for all ten films. On a machine with a GPU, remove the `--use-angle=swiftshader` flags in `render.mjs` for a big speed-up.

## Data credits (required, already in the footer)

- Map data © OpenStreetMap contributors and the Overture Maps Foundation, ODbL / CDLA-Permissive-2.0.
- Copernicus DEM GLO-30 © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA.
- Fonts: Fraunces and Inter, SIL Open Font License 1.1.
