# shellcheck shell=bash
# gh-safe — guard against ACCIDENTAL mutation of GitHub Actions secrets / variables.
#
# WHY: `gh secret set` / `gh variable set` (and their delete forms) are WRITE-ONLY
# and UNRECOVERABLE — GitHub keeps no value history and offers no rollback. A stray
# set/delete during CI debugging silently overwrites a production identity. This
# exact footgun once clobbered GCP_WIF_PROVIDER / GCP_DEPLOY_SA and broke
# policy-server-deploy. This wrapper REFUSES secret/variable writes unless you
# explicitly opt in for that one command.
#
# What is gated (blocked unless ALLOW_GH_SECRET_MUTATION=1):
#   gh secret   set | delete | remove
#   gh variable set | delete | remove
#   gh api  <write-method: PUT/POST/PATCH/DELETE>  …/actions/{secrets,variables}…
# Everything else (gh secret list, gh variable list/get, gh api GET, gh pr/issue/…)
# passes straight through.
#
# USAGE — source it from your shell profile so EVERY `gh` call is guarded
# (including the ones an AI agent runs, since its shell inherits your profile):
#   echo 'source "/Users/jhy/Desktop/ScopeBall/scopeball-registry-v2/scripts/gh-safe.sh"' >> ~/.zshrc
# Make ONE intentional change:
#   ALLOW_GH_SECRET_MUTATION=1 gh secret set MY_SECRET --body "…"
#
# Testability: set GH_SAFE_REAL=/path/to/fake-gh to redirect the pass-through call
# (used by scripts/__tests__/gh-safe.test.sh); defaults to `command gh`.

_gh_safe_refuse() {
  echo "gh-safe: REFUSED \`gh $*\` — GitHub secrets/variables are write-only and unrecoverable" >&2
  echo "gh-safe: (no value history, no rollback). If this is intentional, re-run with:" >&2
  echo "gh-safe:   ALLOW_GH_SECRET_MUTATION=1 gh $*" >&2
}

# True (exit 0) iff a `gh api …` call uses a write method AND targets a
# secrets/variables endpoint.
_gh_safe_api_is_secret_write() {
  local a au prev="" has_write="" hits_target=""
  for a in "$@"; do
    # Uppercase-normalize so a lowercase/mixed method (`-X put`, `--method=post`)
    # is gated exactly like `PUT`/`POST` — gh forwards the method verbatim, so a
    # lowercase write would otherwise slip past this guard. `tr` (not bash-4
    # `${a^^}`) keeps this portable to the zsh profile that sources it.
    au=$(printf '%s' "$a" | tr '[:lower:]' '[:upper:]')
    case "$au" in
      -X | --METHOD) prev="method" ;;
      PUT | POST | PATCH | DELETE)
        [ "$prev" = "method" ] && has_write=1
        prev=""
        ;;
      -X* | --METHOD=*)
        case "$au" in *PUT* | *POST* | *PATCH* | *DELETE*) has_write=1 ;; esac
        prev=""
        ;;
      *SECRETS* | *VARIABLES*)
        hits_target=1
        prev=""
        ;;
      *) prev="" ;;
    esac
  done
  [ -n "$has_write" ] && [ -n "$hits_target" ]
}

gh() {
  if [ "${ALLOW_GH_SECRET_MUTATION:-}" != "1" ]; then
    case "${1:-}:${2:-}" in
      secret:set | secret:delete | secret:remove | \
        variable:set | variable:delete | variable:remove)
        _gh_safe_refuse "$@"
        return 1
        ;;
    esac
    if [ "${1:-}" = "api" ] && _gh_safe_api_is_secret_write "$@"; then
      _gh_safe_refuse "$@"
      return 1
    fi
  fi
  if [ -n "${GH_SAFE_REAL:-}" ]; then
    "$GH_SAFE_REAL" "$@"
  else
    command gh "$@"
  fi
}
