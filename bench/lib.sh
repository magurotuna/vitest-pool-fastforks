# Sourced by the bench scripts. BENCH is the directory for everything that the
# bench installs and writes (default /data/fastforks).
BENCH=${BENCH:-/data/fastforks}
B=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
R=$BENCH/repos
# The Vitest version that the pnpm overrides set.
VITEST_VERSION=${VITEST_VERSION:-5.1.0}
[ -f "$BENCH/env.sh" ] && source "$BENCH/env.sh"

log() { echo "== $(date -u '+%F %T UTC') $*"; }

# clone <dir> <url> <commit>: a checkout at an exact commit.
clone() {
  local dir=$1 url=$2 sha=$3
  if [ ! -d "$dir/.git" ]; then
    log "clone $url"
    git init -q "$dir"
    git -C "$dir" remote add origin "$url"
  fi
  if [ "$(git -C "$dir" rev-parse HEAD 2>/dev/null)" != "$sha" ]; then
    git -C "$dir" fetch -q --depth 1 origin "$sha"
    git -C "$dir" -c advice.detachedHead=false checkout -q "$sha"
  fi
}

# need_pnpm <version>: installs that pnpm version (Node.js 26 has no corepack).
need_pnpm() {
  local v=$1
  if [ ! -x "$BENCH/tools/pnpm-$v/node_modules/.bin/pnpm" ]; then
    log "pnpm $v"
    mkdir -p "$BENCH/tools/pnpm-$v"
    (cd "$BENCH/tools/pnpm-$v" && { [ -f package.json ] || echo '{"private":true}' > package.json; } \
      && npm install --silent --no-audit --no-fund "pnpm@$v")
  fi
}

# pnpmv <version> <args...>: runs that pnpm version, first on PATH, because
# package scripts call pnpm again.
pnpmv() { local v=$1; shift; PATH="$BENCH/tools/pnpm-$v/node_modules/.bin:$PATH" pnpm "$@"; }

# The pnpm version in the packageManager field of a checkout (pnpm@X.Y.Z+sha).
pinned_pnpm() { jq -r .packageManager "$1/package.json" | sed -E 's/^pnpm@([0-9.]+).*/\1/'; }

# install <dir> [<pnpm install option>...]: pnpm install with the pinned
# version, with a retry for slow downloads. Default: --no-frozen-lockfile,
# because the overrides change the lockfile. A marker file says that the
# install finished: a setup that stopped during a postinstall installs again.
install() {
  local dir=$1 v
  shift
  [ $# -gt 0 ] || set -- --no-frozen-lockfile
  v=$(pinned_pnpm "$dir")
  need_pnpm "$v"
  (cd "$dir" && { CI=true pnpmv "$v" install "$@" \
    || CI=true pnpmv "$v" install "$@" --network-concurrency=4 --fetch-timeout=600000; })
  echo "$VITEST_VERSION" > "$dir/node_modules/.fastforks-bench"
}

# installed <dir>: true if install finished in <dir> with this VITEST_VERSION.
installed() { [ "$(cat "$1/node_modules/.fastforks-bench" 2>/dev/null)" = "$VITEST_VERSION" ]; }

# add_overrides <pnpm-workspace.yaml> <version> <name>...: sets each package
# to that version under `overrides:`.
add_overrides() {
  python3 - "$@" <<'PY'
import sys, re
path, version, names = sys.argv[1], sys.argv[2], sys.argv[3:]
s = open(path).read()
if "# fastforks-bench overrides" in s:
    sys.exit(0)
lines = "  # fastforks-bench overrides\n" + "".join(f"  '{n}': {version}\n" for n in names)
if re.search(r"^overrides:\n", s, re.M):
    s = re.sub(r"^overrides:\n", "overrides:\n" + lines, s, count=1, flags=re.M)
else:
    s = s.rstrip("\n") + "\n\noverrides:\n" + lines
open(path, "w").write(s)
PY
}

# config <name> <destination>: copies bench/configs/<name> with @BENCH@
# replaced by $BENCH.
config() { sed "s|@BENCH@|$BENCH|g" "$B/configs/$1" > "$2"; }

for f in "$B"/projects/*.sh; do source "$f"; done
