// Builds the native addon: `npm run build`, or `npm run build -- --arch=x64`.
// The scripts in package.json do not name node-gyp. If a script of a published
// package names node-gyp, Yarn 4 adds node-gyp@latest as a dependency of the
// package in every project that installs it from the npm registry.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const nodeGyp = require.resolve('node-gyp/bin/node-gyp.js')
execFileSync(process.execPath, [nodeGyp, 'rebuild', ...process.argv.slice(2)], { stdio: 'inherit' })
