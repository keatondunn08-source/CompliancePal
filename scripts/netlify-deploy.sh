#!/usr/bin/env bash
# Low-credit Netlify deploys for any client site folder in this repo.
#
#   scripts/netlify-deploy.sh <site-folder>          # DRAFT deploy: a free preview URL (0 credits)
#   scripts/netlify-deploy.sh <site-folder> --prod   # PRODUCTION deploy: 15 credits, skipped if already live
#
# Why this exists: Netlify bills every production deploy (15 credits) plus bandwidth.
# This script is the only sanctioned way to deploy from a Claude session (see CLAUDE.md;
# a PreToolUse hook blocks raw `netlify deploy`). It:
#   - uploads the prebuilt publish folder with --no-build (no build minutes, no remote build)
#   - defaults to a draft deploy, which costs nothing
#   - fingerprints the publish folder and skips a production deploy whose content is already live
#   - pins the CLI version so behaviour doesn't drift between sessions
#
# Needs: NETLIFY_AUTH_TOKEN (environment variable / secret), network access to api.netlify.com, jq, npx.
# Site ID: read from <site-folder>/.netlify-site-id (committed; not a secret), or $NETLIFY_SITE_ID.
# On first run with neither, it creates a site named $NETLIFY_SITE_NAME (default: <folder>-preview)
# and writes the ID file. Creating a site costs nothing.

set -euo pipefail

CLI_VERSION="27.12.0"
die() { echo "netlify-deploy: $*" >&2; exit 1; }

[ $# -ge 1 ] || die "usage: scripts/netlify-deploy.sh <site-folder> [--prod]"
folder="${1%/}"
mode="draft"
case "${2:-}" in
  "") ;;
  --prod) mode="prod" ;;
  *) die "unknown option '$2' (only --prod is supported)" ;;
esac

root="$(git rev-parse --show-toplevel)"
site_dir="$root/$folder"
[ -f "$site_dir/netlify.toml" ] || die "$folder/netlify.toml not found; pass a site folder such as corporate-cleaning-solutions"
command -v jq >/dev/null || die "jq is required"
[ -n "${NETLIFY_AUTH_TOKEN:-}" ] || die "NETLIFY_AUTH_TOKEN is not set. Add a Netlify personal access token to the environment (never paste it into chat)."

publish="$(sed -nE 's/^[[:space:]]*publish[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p' "$site_dir/netlify.toml" | head -1)"
publish="${publish:-site}"
[ -d "$site_dir/$publish" ] || die "publish folder $folder/$publish not found"

netlify() { npx -y "netlify-cli@$CLI_VERSION" "$@"; }

# Fingerprint of exactly what would be uploaded (+ netlify.toml), so identical production deploys are skipped.
fingerprint="$(cd "$site_dir" && { find "$publish" -type f -print0 | sort -z | xargs -0 sha256sum; sha256sum netlify.toml; } | sha256sum | cut -c1-12)"
commit="$(git -C "$root" rev-parse --short HEAD)"
dirty=""
git -C "$root" diff --quiet HEAD -- "$folder" || dirty="+uncommitted"

id_file="$site_dir/.netlify-site-id"
site_id="${NETLIFY_SITE_ID:-$(cat "$id_file" 2>/dev/null || true)}"
if [ -z "$site_id" ]; then
  name="${NETLIFY_SITE_NAME:-$(basename "$folder")-preview}"
  echo "Creating Netlify site '$name' (free)..."
  site_id="$(netlify api createSite --data "{\"body\":{\"name\":\"$name\"}}" | jq -r '.id // empty')"
  [ -n "$site_id" ] || die "could not create site '$name' (name taken? set NETLIFY_SITE_NAME)"
  echo "$site_id" > "$id_file"
  echo "Saved site ID to $folder/.netlify-site-id. Commit it so later sessions reuse this site."
fi

args=()
if [ "$mode" = "prod" ]; then
  live_title="$(netlify api getSite --data "{\"site_id\":\"$site_id\"}" | jq -r '.published_deploy.title // ""')"
  if [[ "$live_title" == *"[$fingerprint]"* ]]; then
    echo "Already live: production has fingerprint $fingerprint. Nothing deployed (0 credits)."
    exit 0
  fi
  echo "PRODUCTION deploy of $folder ($fingerprint): this costs 15 Netlify credits."
  args+=(--prod)
else
  echo "Draft deploy of $folder ($fingerprint): free, 0 credits."
fi

out="$(cd "$site_dir" && netlify deploy --no-build --dir "$publish" --site "$site_id" \
  --message "$mode [$fingerprint] $commit$dirty" --json "${args[@]}")"

if [ "$mode" = "prod" ]; then
  echo "Live: $(jq -r '.url // .deploy_url' <<<"$out")"
  echo "Credits used: 15 (one production deploy)."
else
  echo "Preview: $(jq -r '.deploy_url // .url' <<<"$out")"
  echo "Credits used: 0 (draft deploy)."
fi
