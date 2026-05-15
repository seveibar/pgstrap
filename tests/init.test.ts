import { beforeEach, afterEach, test, expect } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { initPgstrap } from "../src/init"

let testDir: string

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-test-"))
  fs.writeFileSync(
    path.join(testDir, "package.json"),
    JSON.stringify({ name: "some-package" }),
  )
})

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true })
})

test("initPgstrap writes scripts to package.json", async () => {
  await initPgstrap({ cwd: testDir })
  const pkg = JSON.parse(
    fs.readFileSync(path.join(testDir, "package.json"), "utf8"),
  )
  expect(pkg.scripts["db:migrate"]).toBe("pgstrap migrate")
  expect(pkg.scripts["db:reset"]).toBe("pgstrap reset")
  // db:generate defaults to --pglite so users don't need Postgres running
  // in the background to regenerate types/structure. See issue #2.
  expect(pkg.scripts["db:generate"]).toBe("pgstrap generate --pglite")
  expect(pkg.scripts["db:create-migration"]).toBe("pgstrap create-migration")
})

test("initPgstrap defaults db:generate to PGlite (no Postgres needed)", async () => {
  await initPgstrap({ cwd: testDir })
  const pkg = JSON.parse(
    fs.readFileSync(path.join(testDir, "package.json"), "utf8"),
  )
  expect(pkg.scripts["db:generate"]).toContain("--pglite")
})
