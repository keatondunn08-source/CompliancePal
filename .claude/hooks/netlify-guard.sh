#!/usr/bin/env bash
# PreToolUse(Bash) guard: Netlify deploys must go through scripts/netlify-deploy.sh,
# which defaults to free draft deploys and dedupes production deploys (see CLAUDE.md).
# Blocks raw CLI deploys/builds/remote-build triggers and direct API deploy/build calls.
# Fails open (allows) if jq is missing, so a missing tool never blocks every command.

command -v jq >/dev/null 2>&1 || exit 0
cmd="$(jq -r '.tool_input.command // ""')"

# Ignore the sanctioned script's own invocation(s).
rest="$(printf '%s' "$cmd" | sed -E 's#[^[:space:];&|()]*scripts/netlify-deploy\.sh[^;&|]*##g')"

# A netlify/ntl/netlify-cli command in command position (start, after ; & | ( $( or a package runner),
# so text like a commit message that merely mentions "netlify deploy" isn't caught.
pos='(^|[;&|(]|\$\()[[:space:]]*((npx|bunx)[[:space:]]+((-y|--yes)[[:space:]]+)?|(pnpm|yarn)[[:space:]]+dlx[[:space:]]+)?([^[:space:];&|()]*/)?'
cli='(netlify|ntl|netlify-cli(@[^[:space:]]*)?)'
verbs='(deploy|build|init|link|sites:create|api[[:space:]]+(createSiteDeploy|createSiteBuild|restoreSiteDeploy|rollbackSiteDeploy|createSiteBuildHook))'
api='api\.netlify\.com/(api/v1/)?[^[:space:]]*(deploys|builds)|api\.netlify\.com/build_hooks/'

if printf '%s' "$rest" | grep -Eq "${pos}${cli}[[:space:]]+([^;&|]*[[:space:]])?${verbs}([[:space:]]|$)" \
   || printf '%s' "$rest" | grep -Eq "$api"; then
  reason="Blocked by the Netlify credit rules (CLAUDE.md). Deploy only with: scripts/netlify-deploy.sh <site-folder> (draft preview, 0 credits). Add --prod (15 credits, skipped if identical content is already live) only when the user has explicitly asked to go live in production in this conversation. Never trigger remote builds or build hooks."
  jq -n --arg r "$reason" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}'
fi
exit 0
