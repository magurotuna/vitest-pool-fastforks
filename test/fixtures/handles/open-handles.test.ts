import { createServer } from "node:net"
import { test } from "vitest"

test("leaves a server and an interval open", async () => {
  const server = createServer().listen(0)
  setInterval(() => {}, 1000)
  await new Promise((resolve) => server.on("listening", resolve))
})
