import { fastForks } from "vitest-pool-fastforks"

// POOL=fastforks | forks | threads | vmForks
// FASTFORKS_FALLBACK=error makes a run fail if it cannot use fastforks.
export function pool(options) {
  const name = process.env.POOL || "forks"
  return name === "fastforks" ? fastForks({ fallback: process.env.FASTFORKS_FALLBACK || "forks", ...options }) : name
}
