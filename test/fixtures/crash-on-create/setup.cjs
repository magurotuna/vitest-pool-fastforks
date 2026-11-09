// Loaded with --require in every Environment. In fastforks, when a test file
// left a marker with this child process pid, crash while the next test
// file is being set up in the same child process (a reused one). The child
// process itself also loads this file at startup, with
// VITEST_POOL_FASTFORKS_HOST still set: skip that case.
const fs = require("node:fs")
const marker = require("node:path").join(__dirname, ".crash-next-create")
if (process.env.POOL === "fastforks" && !process.env.VITEST_POOL_FASTFORKS_HOST && fs.existsSync(marker)) {
  if (fs.readFileSync(marker, "utf8") === String(process.pid)) {
    fs.rmSync(marker)
    // Not process.kill(): Windows ignores SIGSEGV.
    process.reallyExit(139)
  }
}
