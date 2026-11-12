#!/usr/bin/env bash
# Writes the release notes and annotated tag message for VERSION from CHANGELOG.md in the
# current checkout into the directory $1. Fails unless CHANGELOG.md has exactly one
# "## [VERSION] — YYYY-MM-DD" section and that section is new or changed in HEAD, so an older
# commit cannot be released. Uses only git, awk and sed: no project code runs.
set -euo pipefail
out=$1
fail() {
  echo "::error::$1"
  exit 1
}

# The section from "## [VERSION]" up to the next version heading, trailing blank lines dropped.
section() {
  awk -v h="## [$VERSION]" '
    index($0, h) == 1 { on = 1; print; next }
    on && /^## \[/ { exit }
    on { print }
  ' | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}'
}

tmp=$(mktemp -d)
section <CHANGELOG.md >"$tmp/section.md"
[ -s "$tmp/section.md" ] || fail "CHANGELOG.md has no ## [$VERSION] section."
[ "$(grep -c "^## \[$VERSION\]" CHANGELOG.md)" = 1 ] || fail "CHANGELOG.md has more than one ## [$VERSION] section."
if git show HEAD^1:CHANGELOG.md 2>/dev/null | section >"$tmp/parent.md" && [ -s "$tmp/parent.md" ]; then
  if cmp -s "$tmp/parent.md" "$tmp/section.md"; then
    fail "The ## [$VERSION] section did not change in this commit."
  fi
fi
date=$(head -n 1 "$tmp/section.md" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}$') ||
  fail "The ## [$VERSION] heading has no release date."

mkdir -p "$out"
tail -n +2 "$tmp/section.md" | sed '1{/^$/d}' >"$out/notes.md"
{
  cat "$tmp/section.md"
  echo
  echo "Released-at: $date"
} >"$out/tag-message.txt"
