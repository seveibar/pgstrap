import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import * as generateModule from "../src/generate"

// Point any Postgres connection at a port nothing listens on, simulating
// "no postgres running in the background".
const UNREACHABLE_URL = "postgres://postgres:postgres@127.0.0.1:1/nonexistent"

function resolveGenerateFn(): (...args: any[]) => any {
  const mod = generateModule as Record<string, any>
  const candidates = [
    mod.generate,
    mod.generateTypes,
    mod.generateSchema,
    mod.run,
    mod.main,
    mod.default,
  ]
  const fn = candidates.find((c) => typeof c === "function")
  if (fn) return fn
  const anyFn = Object.values(mod).find((v) => typeof v === "function")
  if (!anyFn) {
    throw new Error("src/generate.ts exports no callable generate function")
  }
  return anyFn as (...args: any[]) => any
}

describe("db:generate must not require a running postgres", () => {
  test("generate source uses pglite (embedded postgres)", () => {
    const src = readFileSync(
      join(import.meta.dir, "..", "src", "generate.ts"),
      "utf8",
    )
    expect(src).toMatch(/pglite/i)
  })

  test("generating types succeeds without a reachable postgres server", async () => {
    const prevDb = process.env.DATABASE_URL
    const prevHost = process.env.PGHOST
    const prevPort = process.env.PGPORT
    process.env.DATABASE_URL = UNREACHABLE_URL
    process.env.PGHOST = "127.0.0.1"
    process.env.PGPORT = "1"

    try {
      const fn = resolveGenerateFn()
      let error: unknown = undefined
      try {
        await fn()
      } catch (e) {
        error = e
      }
      // Expected: no connection to an external postgres is attempted,
      // so no connection error is raised.
      const msg = error ? String((error as any)?.message ?? error) : ""
      expect(msg).not.toMatch(
        /ECONNREFUSED|connect|connection|password authentication/i,
      )
      expect(error).toBeUndefined()
    } finally {
      if (prevDb === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = prevDb
      if (prevHost === undefined) delete process.env.PGHOST
      else process.env.PGHOST = prevHost
      if (prevPort === undefined) delete process.env.PGPORT
      else process.env.PGPORT = prevPort
    }
  })
})
