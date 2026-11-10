// Copies the addon that `npm run build` made into prebuilds/<platform>/,
// where the package looks for it, and removes the build so that the tests
// load the prebuilt addon.
//
// Usage: node scripts/copy-prebuild.ts [arch]
// arch: the CPU of a cross-compiled build (node-gyp rebuild --arch=<arch>).
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { platformTag } from '../src/support.ts'

const arch = process.argv[2]
const tag = arch ? platformTag().replace(process.arch, arch) : platformTag()
const dir = new URL(`../prebuilds/${tag}/`, import.meta.url)
const file = new URL(`node.abi${process.versions.modules}.node`, dir)
mkdirSync(dir, { recursive: true })
copyFileSync(new URL('../build/Release/fastforks.node', import.meta.url), file)
rmSync(new URL('../build/', import.meta.url), { recursive: true, force: true })
console.log(`prebuilds/${tag}/node.abi${process.versions.modules}.node`)
