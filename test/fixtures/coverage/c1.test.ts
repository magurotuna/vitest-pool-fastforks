import { expect, test } from "vitest"
import { sign } from "./src/math"

test("call 1", () => {
  for (let k = 0; k < 1; k++) expect(sign(k)).toBeTypeOf("string")
})
