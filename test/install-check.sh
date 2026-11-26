#!/usr/bin/env bash
# Installs the packed package into a new project with npm, Yarn 4, and pnpm
# 10, as a user does, and runs test files with it. Fails if an install fails,
# if a package manager built the addon, or if the pool falls back to forks.
# Yarn 4 and pnpm 10 run `node-gyp rebuild` at install time for a package
# that has a binding.gyp file, even with "gypfile": false, so these installs
# allow build scripts.
# Usage: bash test/install-check.sh <vitest-pool-fastforks-*.tgz>
set -euo pipefail
tarball=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT

# Yarn 4 adds node-gyp@latest as a dependency of a package from the npm
# registry if a script of the package names node-gyp. The installs below use
# the tarball, where Yarn does not do this, so check the scripts here.
tar -xOzf "$tarball" package/package.json | node -e '
  const { scripts = {} } = JSON.parse(require("node:fs").readFileSync(0, "utf8"))
  const named = Object.entries(scripts).filter(([, script]) => /\b(node-gyp|prebuild-install)\b/.test(script))
  for (const [name, script] of named) console.error(`The script ${name} names node-gyp or prebuild-install: ${script}`)
  process.exitCode = named.length ? 1 : 0
'

check() {
  local manager=$1
  local app=$root/$manager
  mkdir "$app"
  cd "$app"
  case $manager in
    npm)
      npm init -y > /dev/null
      npm install --no-audit --no-fund --save-dev vitest@5.1.0 "$tarball"
      ;;
    yarn)
      echo '{ "name": "app", "private": true, "packageManager": "yarn@4.18.1" }' > package.json
      printf 'nodeLinker: node-modules\nenableScripts: true\nenableGlobalCache: false\n' > .yarnrc.yml
      touch yarn.lock
      # Yarn does not install peer dependencies: vite is one of Vitest.
      npx -y corepack@0.34.0 yarn add -D vitest@5.1.0 vite@8.3.6 "vitest-pool-fastforks@file:$tarball"
      ;;
    pnpm)
      echo '{ "name": "app", "private": true }' > package.json
      # A package name alone in onlyBuiltDependencies does not match a package
      # from a tarball.
      printf 'dangerouslyAllowAllBuilds: true\n' > pnpm-workspace.yaml
      npx -y pnpm@10.34.9 add -D vitest@5.1.0 "$tarball"
      ;;
  esac
  local pkg=node_modules/vitest-pool-fastforks
  if [ -e "$pkg/build" ]; then
    echo "$manager built the addon on install: $pkg/build exists" >&2
    exit 1
  fi
  cat > vitest.config.mjs <<'CONFIG'
import { fastForks } from 'vitest-pool-fastforks'

export default { test: { pool: fastForks({ fallback: 'error' }) } }
CONFIG
  for i in 1 2 3; do
    printf 'import { expect, test } from "vitest"\n\ntest("runs %s", () => {\n  expect(process.send).toBeTypeOf("function")\n})\n' "$i" > "file$i.test.mjs"
  done
  node node_modules/vitest/vitest.mjs run
  echo "$manager installed and ran with prebuilds: $(ls "$pkg/prebuilds" | tr '\n' ' ')"
}

for manager in npm yarn pnpm; do
  (check "$manager")
done
