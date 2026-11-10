// Imports the pool by path, not from node_modules, so that Vite loads a
// separate copy of the pool module for each project config.
import { fastForks } from "../../../../dist/index.mjs"

const pool = process.env.POOL === "fastforks" ? fastForks({ fallback: process.env.FASTFORKS_FALLBACK || "forks" }) : process.env.POOL || "forks"

export default { test: { name: "p0", pool, env: { PROJECT: "0" } } }
