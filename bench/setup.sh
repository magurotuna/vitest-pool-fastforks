#!/usr/bin/env bash
# Sets up the benchmark on a Debian machine: the system packages, Node.js,
# this package (built from this checkout), and the projects at fixed commits.
# Every step can run again after a failure.
# Usage: bash bench/setup.sh [package | <project>...]
#   package: only build this checkout again and install it for the bench.
#   Default: everything and every project.
#   BENCH: the directory for all files (default /data/fastforks).
#   NODE_VERSION: default v26.13.0.
set -euo pipefail
source "$(dirname "$0")/lib.sh"
NODE_VERSION=${NODE_VERSION:-v26.13.0}

machine() {
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git build-essential python3 jq curl xz-utils \
    procps util-linux >/dev/null
  sudo mkdir -p "$BENCH" && sudo chown "$USER:" "$BENCH"
  mkdir -p "$BENCH"/{dl,tools,repos,cache,raw,configs,home}
  # The npm, pnpm, and node-gyp caches go to $BENCH too (on a cloud VM, the
  # root disk can be small).
  for d in .cache .npm .local/share/pnpm .local/state/pnpm; do
    mkdir -p "$BENCH/home/$d" "$(dirname ~/$d)"
    if [ -e ~/$d ] && [ ! -L ~/$d ]; then cp -a ~/$d/. "$BENCH/home/$d/" && rm -rf ~/$d; fi
    [ -L ~/$d ] || ln -s "$BENCH/home/$d" ~/$d
  done

  local arch dir
  case $(uname -m) in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; *) echo "unknown CPU $(uname -m)" >&2; exit 1 ;; esac
  dir=$BENCH/tools/node-$NODE_VERSION-linux-$arch
  if [ ! -x "$dir/bin/node" ]; then
    log "Node.js $NODE_VERSION"
    (cd "$BENCH/dl" && curl -fsSLO "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-$arch.tar.xz" \
      && curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" -o "SHASUMS256-$NODE_VERSION.txt" \
      && grep " node-$NODE_VERSION-linux-$arch.tar.xz\$" "SHASUMS256-$NODE_VERSION.txt" | sha256sum -c -)
    tar -C "$BENCH/tools" -xJf "$BENCH/dl/node-$NODE_VERSION-linux-$arch.tar.xz"
  fi
  cat > "$BENCH/env.sh" <<EOT
# Written by bench/setup.sh.
export PATH=$dir/bin:\$PATH
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 CYPRESS_INSTALL_BINARY=0 PUPPETEER_SKIP_DOWNLOAD=1
EOT
  source "$BENCH/env.sh"
  for f in bench-pool.mjs bench-projects.mjs; do config $f "$BENCH/configs/$f"; done
}

# This checkout, built and copied to $BENCH/node_modules, where the bench
# configs import it from. A copy, not a symlink: Vite follows a symlink to
# the real path.
package() {
  local root n=$BENCH/node_modules/vitest-pool-fastforks
  root=$(cd "$B/.." && pwd)
  log "package $(git -C "$root" describe --always --dirty)"
  (cd "$root" && npm ci --no-audit --no-fund && npm run build:js && npm run build)
  rm -rf "$n" && mkdir -p "$n/build/Release"
  cp -r "$root/dist" "$root/package.json" "$n/"
  cp "$root/build/Release/fastforks.node" "$n/build/Release/"
  git -C "$root" rev-parse HEAD > "$n/COMMIT"
}

PROJECTS=(readest vuetify material-ui base-ui mui-x vitest instructure-ui js-test-runner-competition)
if [ "${1:-}" = package ]; then package; exit 0; fi
projects=("$@")
[ ${#projects[@]} -gt 0 ] || projects=("${PROJECTS[@]}")
machine
package
for p in "${projects[@]}"; do
  log "project $p"
  "setup_${p//-/_}"
done
log done
