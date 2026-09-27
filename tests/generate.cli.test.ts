import { afterEach, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"

const cli = path.resolve(import.meta.dir, "../src/cli.ts")
const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

function project(extraEnv: Record<string, string> = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-cli-"))
  directories.push(cwd)
  fs.writeFileSync(path.join(cwd, "package.json"), '{"name":"offline-test"}')
  // Run the source CLI through the same package script a generated project uses.
  const bin = path.join(cwd, "node_modules", ".bin")
  fs.mkdirSync(bin, { recursive: true })
  fs.writeFileSync(
    path.join(bin, "pgstrap"),
    `#!/usr/bin/env bun\nimport ${JSON.stringify(pathToFileURL(cli).href)}\n`,
    { mode: 0o755 },
  )
  const env = {
    PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`,
    NODE_ENV: "test",
    DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/unreachable",
    ...extraEnv,
  }
  const run = (...args: string[]) =>
    spawnSync(process.execPath, args, {
      cwd,
      env,
      encoding: "utf8",
      timeout: 20_000,
    })
  const initialized = run(cli, "init")
  if (initialized.status !== 0) throw new Error(initialized.stderr)
  expect(initialized.status).toBe(0)
  const migrations = path.join(cwd, "src", "db", "migrations")
  fs.mkdirSync(migrations, { recursive: true })
  return { cwd, migrations, run }
}

test("initialized db:generate creates types and SQL without PostgreSQL", () => {
  const { cwd, migrations, run } = project()
  fs.writeFileSync(
    path.join(migrations, "001_create_widgets.js"),
    `exports.up = (pgm) => {
      pgm.createTable('widgets', {
        id: 'id',
        name: { type: 'text', notNull: true },
      })
    }`,
  )
  const generated = run("run", "db:generate")
  expect(generated.error).toBeUndefined()
  expect(generated.status).toBe(0)
  expect(
    fs.readFileSync(path.join(cwd, "src/db/zapatos/schema.d.ts"), "utf8"),
  ).toContain("widgets")
  expect(
    fs.readFileSync(
      path.join(cwd, "src/db/structure/public/tables/widgets/table.sql"),
      "utf8",
    ),
  ).toMatch(/CREATE TABLE\s+public\.widgets/)
}, 45_000)

test.each(["POSTGRES_URI", "PG_URI"])(
  "offline generation ignores the application's %s connection",
  (variable) => {
    const { cwd, migrations, run } = project({
      [variable]: "postgres://unused:unused@127.0.0.1:1/unreachable",
    })
    fs.writeFileSync(
      path.join(migrations, "001_create_widgets.js"),
      "exports.up = (pgm) => pgm.createTable('widgets', { id: 'id' })",
    )
    const generated = run("run", "db:generate")
    expect(generated.error).toBeUndefined()
    expect(generated.status).toBe(0)
    expect(
      fs.readFileSync(
        path.join(cwd, "src/db/structure/public/tables/widgets/table.sql"),
        "utf8",
      ),
    ).toMatch(/CREATE TABLE\s+public\.widgets/)
  },
  45_000,
)

test("invalid migrations make offline generation exit with an error", () => {
  const { migrations, run } = project()
  fs.writeFileSync(
    path.join(migrations, "001_invalid.js"),
    "exports.up = (pgm) => pgm.sql('THIS IS NOT SQL')",
  )
  const generated = run("run", "db:generate")
  expect(generated.error).toBeUndefined()
  expect(generated.status).not.toBe(0)
  expect(generated.stderr).toContain("syntax error")
}, 45_000)

test("an output error closes the gateway instead of hanging the CLI", () => {
  const { cwd, migrations, run } = project()
  fs.writeFileSync(
    path.join(migrations, "001_create_widgets.js"),
    "exports.up = (pgm) => pgm.createTable('widgets', { id: 'id' })",
  )
  fs.writeFileSync(path.join(cwd, "src/db/zapatos"), "not a directory")
  const generated = run("run", "db:generate")
  expect(generated.error).toBeUndefined()
  expect(generated.status).not.toBe(0)
  expect(generated.stderr).toContain("EEXIST")
}, 45_000)

test("a schema dump error closes its subprocess and the gateway", () => {
  const { cwd, migrations, run } = project()
  fs.writeFileSync(
    path.join(migrations, "001_create_widgets.js"),
    "exports.up = (pgm) => pgm.createTable('widgets', { id: 'id' })",
  )
  fs.writeFileSync(path.join(cwd, "src/db/structure"), "not a directory")
  const generated = run("run", "db:generate")
  expect(generated.error).toBeUndefined()
  expect(generated.status).not.toBe(0)
  expect(generated.stderr).toMatch(/EEXIST|ENOTDIR/)
}, 45_000)

test("offline generation does not inherit application SSL requirements", () => {
  const { migrations, run } = project({ PGSSLMODE: "require" })
  fs.writeFileSync(
    path.join(migrations, "001_create_widgets.js"),
    "exports.up = (pgm) => pgm.createTable('widgets', { id: 'id' })",
  )
  const generated = run("run", "db:generate")
  expect(generated.error).toBeUndefined()
  expect(generated.status).toBe(0)
}, 45_000)

test("a failed dump query exits instead of keeping a database socket open", () => {
  const { cwd, migrations, run } = project()
  fs.writeFileSync(
    path.join(migrations, "001_create_widgets.js"),
    "exports.up = (pgm) => pgm.createTable('widgets', { id: 'id' })",
  )
  // The dumper rejects its IN () query for an empty schema selection.
  fs.writeFileSync(
    path.join(cwd, "pgstrap.config.js"),
    "module.exports = { schemas: [] }",
  )
  const generated = run("run", "db:generate")
  expect(generated.error).toBeUndefined()
  expect(generated.status).not.toBe(0)
  expect(generated.stderr).toContain("Schema dump failed:")
}, 45_000)

test("generate without --pglite still uses the configured PostgreSQL connection", () => {
  const { run } = project()
  const generated = run(cli, "generate")
  expect(generated.error).toBeUndefined()
  expect(generated.status).not.toBe(0)
  expect(generated.stdout + generated.stderr).toContain("ECONNREFUSED")
}, 45_000)
