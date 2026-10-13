# CompliancePal repo: client websites

Each top-level folder is one client's static site (`addison-joinery/`, `corporate-cleaning-solutions/`). The deployable output is the folder's prebuilt `site/` directory, which is committed. Netlify never needs to build anything.

## Netlify: use as few credits as possible (mandatory)

Netlify bills in credits (credit-based plans; the Free plan includes 300 a month):

| What | Credits |
|---|---|
| Production deploy | **15 each** |
| Deploy Preview / branch deploy / CLI draft deploy | 0 |
| Bandwidth | 20 per GB |
| Web requests | 2 per 10,000 |
| Functions / compute | 10 per GB-hour |

Rules for every session:

1. **Deploy only with `scripts/netlify-deploy.sh <site-folder>`.** A PreToolUse hook (`.claude/hooks/netlify-guard.sh`) blocks raw `netlify deploy`, `netlify build`, `--trigger`, build hooks and API deploy calls.
2. **Draft by default.** Plain `scripts/netlify-deploy.sh <folder>` makes a draft deploy: a working preview URL for 0 credits. Use it for reviews and for showing prospects.
3. **Production is opt-in and happens once.**
   - Add `--prod` only when the user explicitly asks in this conversation to put the site live on its production URL or domain.
   - Make at most one production deploy per session, at the end, after every change is committed.
   - The script skips the deploy (0 credits) if identical content is already live.
   - Every production deploy costs 15 credits, so never deploy to production just to check something.
4. **Verify locally, not on Netlify.** Use `npx serve <folder>/site` plus Lighthouse/Playwright. Never redeploy to test a fix.
5. **Never trigger Netlify builds.**
   - No build hooks, "Retry deploy", "Clear cache and deploy", or `netlify deploy --trigger`.
   - Don't add Netlify Functions, Edge Functions, scheduled functions or Image CDN transforms. Sites stay static.
6. **Git-connected sites.**
   - Every `netlify.toml` has an `ignore` command, so Netlify only builds a site when its own `site/` or `netlify.toml` changed. Keep it when creating new site folders.
   - Never push to a site's production branch just to deploy. If you must push there, put `[skip netlify]` in the commit message unless the user asked for a deploy.
7. **Bandwidth is the other cost.**
   - Keep pages light: WebP with `srcset`, video only where it earns its place.
   - Hero video loads only on screens that show it: 4K only for big high-res screens on fast connections, portrait cuts on phones.
   - Keep long cache headers on media.
   - Don't host large downloads (PDFs, zips, raw footage) on the sites.
8. **Tell the user the cost.** After any deploy, report the URL and the credits it used (0 for a draft, 15 for production, 0 if skipped).

Setup needed once per environment: a `NETLIFY_AUTH_TOKEN` environment variable (never pasted into chat), and network access to `api.netlify.com`.

## Building a site

Each site folder has a README with its build and verification steps. Generated HTML is committed, so re-run the folder's generator (e.g. `node corporate-cleaning-solutions/tools/build/build.mjs`) after editing its content, CSS or JS.
