#!/usr/bin/env bash
# Release guards: tag<->version consistency + required package files.
# Shared by release.yml pack-preview and publish jobs.
set -euo pipefail

PKG_V="$(node -p "require('./package.json').version")"

if [ -n "${GITHUB_REF_NAME:-}" ] && [[ "$GITHUB_REF_NAME" == v* ]]; then
  TAG_V="${GITHUB_REF_NAME#v}"
  if [ "$TAG_V" != "$PKG_V" ]; then
    echo "::error::tag v$TAG_V does not match package.json version $PKG_V"
    exit 1
  fi
  echo "tag/version guard: OK (v$TAG_V)"
else
  echo "no tag ref — publishing package.json version $PKG_V"
fi

required=(
  dist/cjs/index.js
  dist/esm/index.js
  index.js
  index.d.ts
  CHANGELOG.md
  cli/rivid.mjs
  README.md
  LICENSE
)
for f in "${required[@]}"; do
  if [ ! -f "$f" ]; then
    echo "::error::required file missing from package tree: $f"
    exit 1
  fi
done

npm pack --dry-run >/dev/null
echo "tarball gate: OK"
