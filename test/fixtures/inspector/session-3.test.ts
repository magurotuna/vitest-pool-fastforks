import { test } from "vitest"
import { checkBlockCoverage } from "./session.ts"

test("block coverage through node:inspector (3)", checkBlockCoverage)
