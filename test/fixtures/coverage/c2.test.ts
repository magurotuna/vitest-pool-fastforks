import { expect, test } from "vitest"
import { sign } from "./src/math"

test("call 2", () => {
  for (let k = 0; k < 2; k++) expect(sign(k)).toBeTypeOf("string")
})
