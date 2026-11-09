import { test } from "vitest"

test("keeps the event loop busy after the file", () => {
  const timer = setInterval(() => {
    const end = Date.now() + 50
    while (Date.now() < end) {}
  }, 10)
  void timer
})
