#!/usr/bin/env bash
# Installs the packed package into a new project, as a user does, and runs a
# test file with it. Fails if npm built the addon or if the pool falls back
# to forks.
# Usage: bash test/install-check.sh <vitest-pool-fastforks-*.tgz>
set -euo pipefail
tarball=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
app=$(mktemp -d)
cd "$app"
npm init -y > /dev/null
npm install --no-audit --no-fund --save-dev vitest@5.1.0 "$tarball"
pkg=node_modules/vitest-pool-fastforks
if [ -e "$pkg/build" ]; then
  echo "npm built the addon on install: $pkg/build exists" >&2
  exit 1
fi
cat > vitest.config.mjs <<'CONFIG'
import { fastForks } from 'vitest-pool-fastforks'

export default { test: { pool: fastForks({ fallback: 'error' }) } }
CONFIG
for i in 1 2 3; do
  printf 'import { expect, test } from "vitest"\n\ntest("runs %s", () => {\n  expect(process.send).toBeTypeOf("function")\n})\n' "$i" > "file$i.test.mjs"
done
npx vitest run
echo "installed and ran with prebuilds: $(ls "$pkg/prebuilds" | tr '\n' ' ')"
