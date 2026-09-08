import { beforeAll, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { initPgstrap } from "../src/init"

const root = path.resolve(import.meta.dir, "..")
const unavailableDatabase = "postgres://test:test@127.0.0.1:1/unavailable"

beforeAll(async () => {
  const build = Bun.spawn([process.execPath, "run", "build"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(build.stdout).text(),
    new Response(build.stderr).text(),
    build.exited,
  ])
  if (exitCode !== 0) throw new Error(`${stdout}\n${stderr}`)
}, 20000)

async function runGeneratedScript(options: {
  args?: string[]
  brokenMigration?: boolean
  blockedOutput?: boolean
}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-cli-"))
  try {
    fs.writeFileSync(
      path.join(cwd, "package.json"),
      JSON.stringify({ name: "fixture" }),
    )
    await initPgstrap({ cwd })
    if (options.blockedOutput) {
      fs.writeFileSync(path.join(cwd, "src/db/zapatos"), "occupied")
    }
    const migrationsDir = path.join(cwd, "src/db/migrations")
    fs.mkdirSync(migrationsDir, { recursive: true })
    fs.writeFileSync(
      path.join(migrationsDir, "1700000000000_create_receipt_rows.js"),
      options.brokenMigration
        ? "exports.up = () => { throw new Error('intentional migration failure') }"
        : "exports.up = (pgm) => pgm.createTable('receipt_rows', { id: 'id', display_name: { type: 'text', notNull: true } })",
    )
    const binDir = path.join(cwd, "node_modules/.bin")
    fs.mkdirSync(binDir, { recursive: true })
    const cli = path.join(root, "dist/cli.cjs")
    fs.chmodSync(cli, 0o755)
    fs.symlinkSync(cli, path.join(binDir, "pgstrap"))

    const child = Bun.spawn(
      [process.execPath, "run", "db:generate", ...(options.args ?? [])],
      {
        cwd,
        env: {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
          DATABASE_URL: unavailableDatabase,
          POSTGRES_URI: unavailableDatabase,
          PG_URI: unavailableDatabase,
          DATABASE_URI: unavailableDatabase,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, 10000)
    let stdout: string
    let stderr: string
    let exitCode: number
    try {
      ;[stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
    } finally {
      clearTimeout(timer)
    }
    const schemaPath = path.join(cwd, "src/db/zapatos/schema.d.ts")
    const tablePath = path.join(
      cwd,
      "src/db/structure/public/tables/receipt_rows/table.sql",
    )
    return {
      exitCode,
      timedOut,
      output: `${stdout}\n${stderr}`,
      schema: fs.existsSync(schemaPath)
        ? fs.readFileSync(schemaPath, "utf8")
        : "",
      table: fs.existsSync(tablePath) ? fs.readFileSync(tablePath, "utf8") : "",
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true })
  }
}

test("initialized db:generate needs no external PostgreSQL server", async () => {
  const result = await runGeneratedScript({})
  expect(result.output).not.toContain("ECONNREFUSED")
  expect(result.exitCode).toBe(0)
  expect(result.timedOut).toBe(false)
  expect(result.schema).toContain("receipt_rows")
  expect(result.schema).toContain("display_name")
  expect(result.table).toContain("receipt_rows")
  expect(result.table).toContain("display_name")
}, 15000)

test("--no-pglite explicitly uses the configured PostgreSQL connection", async () => {
  const result = await runGeneratedScript({ args: ["--no-pglite"] })
  expect(result.exitCode).not.toBe(0)
  expect(result.timedOut).toBe(false)
  expect(result.output).toContain("ECONNREFUSED")
  expect(result.schema).toBe("")
}, 15000)

test("default generation reports migration failures and exits", async () => {
  const result = await runGeneratedScript({ brokenMigration: true })
  expect(result.exitCode).not.toBe(0)
  expect(result.timedOut).toBe(false)
  expect(result.output).toContain("intentional migration failure")
  expect(result.schema).toBe("")
}, 15000)

test("generation exits when output cannot be written after migrations", async () => {
  const result = await runGeneratedScript({ blockedOutput: true })
  expect(result.exitCode).not.toBe(0)
  expect(result.timedOut).toBe(false)
  expect(result.output).toMatch(/EEXIST|ENOTDIR/)
  expect(result.schema).toBe("")
}, 15000)
