import { expect, test } from "vitest"
import { sign } from "./src/math"

test("call 4", () => {
  for (let k = 0; k < 4; k++) expect(sign(k)).toBeTypeOf("string")
})
