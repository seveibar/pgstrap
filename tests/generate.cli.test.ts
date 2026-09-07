import { afterEach, beforeEach, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { initPgstrap } from "../src/init"

let projectDir: string
const cliPath = path.resolve(import.meta.dir, "../src/cli.ts")
const unavailableDatabase =
  "postgres://postgres:postgres@127.0.0.1:1/unavailable"

beforeEach(async () => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-cli space-#-"))
  fs.writeFileSync(
    path.join(projectDir, "package.json"),
    JSON.stringify({ name: "generate-fixture" }),
  )
  await initPgstrap({ cwd: projectDir })
  const migrationsDir = path.join(projectDir, "src/db/migrations")
  fs.mkdirSync(migrationsDir, { recursive: true })
  fs.writeFileSync(
    path.join(migrationsDir, "1700000000000_create_widget.js"),
    `exports.up = (pgm) => pgm.createTable("widget", {
      id: "id", name: { type: "text", notNull: true }
    })`,
  )
})

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true })
})

const run = (args: string[], binDir = "", executable = process.execPath) =>
  spawnSync(executable, args, {
    cwd: projectDir,
    encoding: "utf8",
    timeout: 15000,
    env: {
      ...process.env,
      PATH: [binDir, path.dirname(process.execPath), process.env.PATH].join(
        path.delimiter,
      ),
      DATABASE_URL: unavailableDatabase,
      POSTGRES_URI: unavailableDatabase,
      PG_URI: unavailableDatabase,
      DATABASE_URI: unavailableDatabase,
      PGHOST: "127.0.0.1",
      PGPORT: "1",
    },
  })

const expectGeneratedFiles = () => {
  const schema = fs.readFileSync(
    path.join(projectDir, "src/db/zapatos/schema.d.ts"),
    "utf8",
  )
  const structure = fs.readFileSync(
    path.join(projectDir, "src/db/structure/public/tables/widget/table.sql"),
    "utf8",
  )
  expect(schema).toContain("widget")
  expect(schema).toContain("name: string")
  expect(structure).toContain("widget")
}

test("generate CLI defaults to PGlite despite external connection settings", () => {
  const result = run([cliPath, "generate"])
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(0)
  expectGeneratedFiles()
})

test("compiled Node CLI loads the project config from a filesystem path", () => {
  const projectRoot = path.resolve(import.meta.dir, "..")
  const build = spawnSync(process.execPath, ["run", "build"], {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: 20000,
  })
  if (build.status !== 0) throw new Error(build.stdout + build.stderr)
  expect(build.error).toBeUndefined()

  const result = run(
    [path.join(projectRoot, "dist/cli.cjs"), "generate"],
    "",
    "node",
  )
  if (result.status !== 0) throw new Error(result.stdout + result.stderr)
  expect(result.error).toBeUndefined()
  expectGeneratedFiles()
}, 30000)

test("scaffolded bun run db:generate works without Postgres", () => {
  const binDir = path.join(projectDir, "bin")
  fs.mkdirSync(binDir)
  const executable = path.join(
    binDir,
    process.platform === "win32" ? "pgstrap.cmd" : "pgstrap",
  )
  // Run the real source CLI through the scaffolded script, without publishing it.
  fs.writeFileSync(
    executable,
    process.platform === "win32"
      ? `@"${process.execPath}" "${cliPath}" %*\r\n`
      : `#!/usr/bin/env bun\nawait import(${JSON.stringify(pathToFileURL(cliPath).href)})\n`,
    { mode: 0o755 },
  )
  const result = run(["run", "db:generate"], binDir)
  if (result.status !== 0) throw new Error(result.stdout + result.stderr)
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(0)
  expectGeneratedFiles()
})

test("--no-pglite preserves the external Postgres opt-out", () => {
  const result = run([cliPath, "generate", "--no-pglite"])
  expect(result.error).toBeUndefined()
  expect(result.status).not.toBe(0)
  expect(result.stdout + result.stderr).toContain("ECONNREFUSED")
  expect(
    fs.existsSync(path.join(projectDir, "src/db/zapatos/schema.d.ts")),
  ).toBe(false)
})
