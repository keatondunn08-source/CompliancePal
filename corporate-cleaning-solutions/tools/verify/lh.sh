#!/usr/bin/env bash
# lh.sh <mobile|desktop> <path>...   → prints scores, key metrics and failing audits
# Run from tools/verify after `npm install`, with `npm run serve` running on :8080.
cd "$(dirname "$0")"
export CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome
form=$1; shift
mkdir -p lh
for p in "$@"; do
  name=$(echo "$p" | sed 's/[^a-z0-9]\+/_/g'); [ -z "$name" ] && name=home
  extra=""; [ "$form" = desktop ] && extra="--preset=desktop"
  npx lighthouse "http://localhost:8080$p" $extra --quiet --output=json --output-path="lh/$form$name.json" \
    --chrome-flags="--headless=new --no-sandbox --disable-gpu" >/dev/null 2>lh/err.log || { echo "FAIL $p"; tail -5 lh/err.log; continue; }
  node -e '
    const r = require(process.argv[1]); const c = r.categories, a = r.audits;
    const s = (k) => Math.round(c[k].score * 100);
    const m = (k) => a[k].displayValue;
    console.log(`${process.argv[2].padEnd(30)} P${s("performance")} A${s("accessibility")} BP${s("best-practices")} SEO${s("seo")} | FCP ${m("first-contentful-paint")} LCP ${m("largest-contentful-paint")} TBT ${m("total-blocking-time")} CLS ${m("cumulative-layout-shift")} SI ${m("speed-index")}`);
    for (const [cat, obj] of Object.entries(c)) for (const ref of obj.auditRefs) {
      const au = a[ref.id]; if (ref.weight > 0 && au.score !== null && au.score < 1 && cat !== "performance") console.log(`   ✗ ${cat}: ${ref.id} — ${au.title}`);
    }
    const lcpEl = a["largest-contentful-paint-element"]?.details?.items?.[0]?.items?.[0]?.node?.snippet; if (lcpEl) console.log(`   LCP el: ${lcpEl.slice(0, 120)}`);
  ' "$PWD/lh/$form$name.json" "$form $p"
done
