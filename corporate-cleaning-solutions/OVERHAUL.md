# Overhaul brief: Corporate Cleaning Solutions site

Written at the end of the first build session for the session that does the redesign. Read this, then `README.md`, then `/CLAUDE.md`. The client-facing goal is a site Keaton can sell. The owner of the business is Justin.

## What Keaton said about v1

> "Why does everything look like it's AI slop now? … The only good thing is the Where We Work map. Everything else is shit."
> "Look at [the reference site]. Follow that same kind of formatting."
> "Extract real jobs from their website and do the before-and-after scrubbing effect. Make that instead of the 'What We Clean' all that bullshit."
> "Why are you using purple? It just looks like even more slop."
> "When I meant flyovers, I meant actual drone 4K footage from Pexels or something like that."
> "Fix this immediately and make no mistakes."

v1 failed on look, not on engineering:

- **The look was the generic AI one:** purple/jacaranda on dark navy, extra-wide Archivo headings, rounded card grids, and the frost/squeegee hero wipe.
- **The heroes were night-map renders**, not footage.

## Decisions already made (don't re-ask)

| Topic | Decision |
|---|---|
| Reference for format | **https://norwestenviroclean.netlify.app/** (Keaton called it "Central Coast Softwash", but this is the link he gave). Match its layout and formatting closely. |
| Network | Keaton is setting the environment to **full network access**. Pexels, Pixabay, the client's site, the reference and Netlify should all be reachable. If they aren't, stop and tell him. |
| Hero / flyovers | **Real 4K drone footage** from free sources (Pexels, Pixabay, etc.). No renders, no maps in heroes, no AI video. |
| Before/after | **Real job photos from his site only.** Where there's a true before/after pair, use a scrub/drag before-after. Where there's only one real photo, the scrub wipes a grime layer off to reveal the real finished shot, captioned as the finished job, never as a "before". No stock before/afters. |
| Colours | **His brand colours**, taken from his logo and current site. Purple is banned. |
| Keep | The **Where We Work interactive regions map** (restyle it to the new palette). Keep the area pages and their unique copy, the generator architecture, the honesty rules, Lighthouse 100 and the Netlify credit rules. |
| Remove | The "What we clean" specialty cards, the purple palette, dark-navy-everywhere, the expanded display type, the frost/squeegee hero wipe and the night-map heroes. The map stills in `site/assets/img/map/` can go once footage replaces them; keep `tools/maps` for the regions SVG and facts. |

## Do this, in order

1. **Check access.** `curl` Pexels, `videos.pexels.com`, the reference URL and `corporatecleaningsolutions.com.au`. If any is blocked, tell Keaton which host and stop.
2. **Study the reference properly.**
   - Screenshot it full-page at desktop (1440) and mobile (412) with Playwright (`tools/verify/shoot.mjs` pattern, absolute URL).
   - Read its HTML and CSS: section order, hero treatment, how the before/after works, type, spacing, nav and CTA style, review/trust blocks, footer.
   - Write a short section map before building, and copy its structure and formatting faithfully.
3. **Crawl the client's site** (`corporatecleaningsolutions.com.au`): every page, including `/our-services/`, `/testimonials/`, `/contact-us/`, blog posts and `wp-content/uploads`.
   - Collect: logo (SVG/PNG), brand colours (CSS and logo), every real job photo, **real testimonials with names**, ABN, hours, phones, emails and the service list.
   - Save the raw downloads in a gitignored `tools/client/.cache/`. Only optimised derivatives go into `site/`.
   - Update `tools/build/content.mjs` facts and resolve the CONFIRM items in `README.md` where his site settles them (school count, hours, ABN).
4. **Footage.**
   - Find real 4K Brisbane drone clips on Pexels/Pixabay: CBD, river, Story Bridge, South Bank, plus anything suburb-specific.
   - Check each clip's licence page. Put clips in `tools/footage/clips.json` with **truthful captions**, run `node tools/footage/encode.mjs`, then `node tools/build/build.mjs`.
   - The home hero tours the clips. Each area page uses its own area's footage if it exists; otherwise the closest real Brisbane aerial, captioned for what it actually shows (never label CBD footage as Moorooka).
   - Credits go in the footer automatically.
   - The 4K tier logic already exists in `site.js` (2160p only for ≥1600 CSS px wide screens with ≥2400 physical px on a fast connection).
5. **Before/after section** replaces "What we clean" on the home page and goes onto the service pages:
   - Real jobs from step 3.
   - Drag on desktop and touch-drag on mobile, with keyboard support (arrow keys on a focusable `role="slider"` handle with `aria-valuenow`) and a reduced-motion fallback.
   - Lazy-load the images so it doesn't touch LCP.
6. **Restyle everything** to the reference's format and his brand colours. Start in the `:root` tokens in `site.css`. Swap the fonts if the reference uses different ones: self-host, subset and preload, keeping `font-display: optional`.
7. **Verify, then report.**
   - `cd tools/verify && npm install && npm run serve`, then `./lh.sh mobile …` and `./lh.sh desktop …` on all 14 pages. Every run must score 100/100/100/100 (v1 did, and its fixes are documented in `README.md` → "The hero").
   - Take screenshots of every page at desktop and mobile, and compare them side by side with the reference before showing Keaton anything.
8. **Deploy a draft** with `scripts/netlify-deploy.sh corporate-cleaning-solutions` (0 credits) if `NETLIFY_AUTH_TOKEN` is set. Don't use `--prod` unless Keaton asks. Report the URL and the credits used.
9. **Commit and push** to the session's designated branch.

## Rules that still apply

- **No invented content.** No made-up testimonials (Australian Consumer Law), stats, client names or claims. If his site doesn't say it, the new site doesn't either.
- **Truthful captions.** Footage and photo captions describe what's actually shown.
- **Fixed constraints:** Lighthouse 100 ×4 on every page, mobile and desktop, plus the CSP in `site/_headers` (self-hosted assets only; no inline scripts or styles).
- **No crawling past his own site** for photos: his site's photos are his; other businesses' photos aren't.
