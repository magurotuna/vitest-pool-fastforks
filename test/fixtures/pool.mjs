import { fastForks } from "vitest-pool-fastforks"

// POOL=fastforks | forks | threads | vmForks
export function pool(options) {
  const name = process.env.POOL || "forks"
  return name === "fastforks" ? fastForks(options) : name
}
