#!/usr/bin/env bash
# Test scripts/gh-safe.sh — secret/variable writes are blocked, reads pass through.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
# A fake `gh` that records that the pass-through actually ran.
FAKE_GH="$(mktemp)"
cat >"$FAKE_GH" <<'EOF'
#!/usr/bin/env bash
echo "REAL_GH_CALLED $*"
EOF
chmod +x "$FAKE_GH"
export GH_SAFE_REAL="$FAKE_GH"

# shellcheck source=/dev/null
source "$HERE/../gh-safe.sh"

pass=0
fail=0
# expect_block "<desc>" <command...>  — command must NOT reach the real gh, exit != 0.
expect_block() {
  local desc="$1"
  shift
  local out rc
  out="$("$@" 2>&1)"
  rc=$?
  if [ "$rc" -ne 0 ] && ! printf '%s' "$out" | grep -q "REAL_GH_CALLED" &&
    printf '%s' "$out" | grep -q "REFUSED"; then
    echo "ok   (blocked) $desc"
    pass=$((pass + 1))
  else
    echo "FAIL (should block) $desc :: rc=$rc out=$out"
    fail=$((fail + 1))
  fi
}
# expect_allow "<desc>" <command...> — command MUST reach the real gh.
expect_allow() {
  local desc="$1"
  shift
  local out
  out="$("$@" 2>&1)"
  if printf '%s' "$out" | grep -q "REAL_GH_CALLED"; then
    echo "ok   (allowed) $desc"
    pass=$((pass + 1))
  else
    echo "FAIL (should allow) $desc :: out=$out"
    fail=$((fail + 1))
  fi
}

expect_block "gh secret set"            gh secret set FOO --body x
expect_block "gh secret delete"         gh secret delete FOO
expect_block "gh variable set"          gh variable set BAR --body y
expect_block "gh variable delete"       gh variable delete BAR
expect_block "gh api PUT secret"        gh api -X PUT "repos/o/r/actions/secrets/FOO"
expect_block "gh api POST variable"     gh api --method POST "repos/o/r/actions/variables"

expect_allow "gh secret list"           gh secret list
expect_allow "gh variable list"         gh variable list
expect_allow "gh api GET secrets pubkey" gh api "repos/o/r/actions/secrets/public-key"
expect_allow "gh pr list"               gh pr list
expect_allow "gh repo view"             gh repo view

# Explicit opt-out lets a write through (the documented escape hatch).
_optout_out="$(ALLOW_GH_SECRET_MUTATION=1 gh secret set FOO --body x 2>&1)"
if printf '%s' "$_optout_out" | grep -q "REAL_GH_CALLED"; then
  echo "ok   (allowed) opt-out: gh secret set"
  pass=$((pass + 1))
else
  echo "FAIL (opt-out should allow) :: out=$_optout_out"
  fail=$((fail + 1))
fi

rm -f "$FAKE_GH"
echo "---- gh-safe: $pass passed, $fail failed ----"
[ "$fail" -eq 0 ]
