import { test } from "vitest"
import { checkBlockCoverage } from "./session.ts"

test("block coverage through node:inspector (1)", checkBlockCoverage)
