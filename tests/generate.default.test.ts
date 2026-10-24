import { afterEach, beforeAll, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { generate } from "../src/generate"
import { initPgstrap } from "../src/init"

const root = path.resolve(import.meta.dir, "..")
const directories: string[] = []
const envKeys = ["POSTGRES_URI", "PG_URI", "DATABASE_URL"] as const
const originalEnv = envKeys.map((key) => [key, process.env[key]] as const)
const unavailable = "postgres://postgres:postgres@127.0.0.1:1/unavailable"

function fixture() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-default-"))
  directories.push(cwd)
  const dbDir = path.join(cwd, "src", "db")
  const migrationsDir = path.join(dbDir, "migrations")
  fs.mkdirSync(migrationsDir, { recursive: true })
  fs.writeFileSync(path.join(cwd, "package.json"), '{"name":"generation-test"}')
  fs.writeFileSync(
    path.join(migrationsDir, "1700000000000_create_widgets.js"),
    `exports.up = (pgm) => {
      pgm.createTable('widgets', {
        id: 'id',
        name: { type: 'text', notNull: true },
        quantity: { type: 'integer', notNull: true, default: 0 },
      })
    }`,
  )
  return {
    cwd,
    dbDir,
    migrationsDir,
    defaultDatabase: "unused",
    schemas: ["public"],
  }
}

function expectArtifacts(dbDir: string) {
  const types = fs.readFileSync(
    path.join(dbDir, "zapatos", "schema.d.ts"),
    "utf8",
  )
  const sql = fs.readFileSync(
    path.join(dbDir, "structure", "public", "tables", "widgets", "table.sql"),
    "utf8",
  )
  expect(types).toContain("namespace widgets")
  expect(types).toMatch(/name: string/)
  expect(types).toMatch(/quantity: number/)
  expect(sql).toMatch(/CREATE TABLE\s+public\.widgets/)
  expect(sql).toContain("name text NOT NULL")
  expect(sql).toContain("quantity integer NOT NULL DEFAULT 0")
}

async function run(command: string[], cwd: string, env = process.env) {
  const child = Bun.spawn(command, { cwd, env, stdout: "pipe", stderr: "pipe" })
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    child.kill()
  }, 25000)
  try {
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(
      timedOut,
      "child process should exit without forced termination",
    ).toBe(false)
    return { code, stdout, stderr }
  } finally {
    clearTimeout(timeout)
  }
}

beforeAll(async () => {
  const result = await run([process.execPath, "run", "build"], root)
  expect(result.code, result.stdout + result.stderr).toBe(0)
}, 30000)

afterEach(() => {
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  for (const dir of directories.splice(0))
    fs.rmSync(dir, { recursive: true, force: true })
})

test("library defaults to PGlite and ignores/restores PostgreSQL URLs", async () => {
  const ctx = fixture()
  for (const key of envKeys) process.env[key] = unavailable
  await generate(ctx)
  expectArtifacts(ctx.dbDir)
  for (const key of envKeys) expect(process.env[key]).toBe(unavailable)
}, 30000)

test("explicit PGlite leaves originally absent URLs absent", async () => {
  const ctx = fixture()
  for (const key of envKeys) delete process.env[key]
  await generate({ ...ctx, pglite: true })
  expectArtifacts(ctx.dbDir)
  for (const key of envKeys) expect(process.env[key]).toBeUndefined()
}, 30000)

test.each(["zapatos", "structure"])(
  "failed %s output restores URLs and allows another generation",
  async (output) => {
    const ctx = fixture()
    for (const key of envKeys) process.env[key] = unavailable
    fs.writeFileSync(path.join(ctx.dbDir, output), "not a directory")
    await expect(generate(ctx)).rejects.toThrow()
    for (const key of envKeys) expect(process.env[key]).toBe(unavailable)
    fs.unlinkSync(path.join(ctx.dbDir, output))
    await generate(ctx)
    expectArtifacts(ctx.dbDir)
  },
  30000,
)

test("pglite:false still uses the configured external database", async () => {
  const ctx = fixture()
  for (const key of envKeys) process.env[key] = unavailable
  const script = path.join(ctx.cwd, "external.ts")
  fs.writeFileSync(
    script,
    `import { generate } from ${JSON.stringify(pathToFileURL(path.join(root, "src", "generate.ts")).href)}; await generate(${JSON.stringify({ ...ctx, pglite: false })})`,
  )
  // Zapatos exits the process on a connection failure, so test this in a child.
  const result = await run([process.execPath, script], ctx.cwd)
  expect(result.code).toBe(1)
  expect(result.stdout + result.stderr).toContain("ECONNREFUSED")
  for (const key of envKeys) expect(process.env[key]).toBe(unavailable)
}, 30000)

test("default library generation exits successfully without PostgreSQL", async () => {
  const ctx = fixture()
  for (const key of envKeys) process.env[key] = unavailable
  const script = path.join(ctx.cwd, "default.ts")
  fs.writeFileSync(
    script,
    `import { generate } from ${JSON.stringify(pathToFileURL(path.join(root, "src", "generate.ts")).href)}; await generate(${JSON.stringify(ctx)})`,
  )
  const result = await run([process.execPath, script], ctx.cwd)
  expect(result.code, result.stdout + result.stderr).toBe(0)
  expectArtifacts(ctx.dbDir)
}, 30000)

async function runScript(ctx: ReturnType<typeof fixture>, args: string[] = []) {
  await initPgstrap({ cwd: ctx.cwd })
  // Exercise the actual initialized script through the built package executable.
  const bin = path.join(ctx.cwd, "node_modules", ".bin")
  fs.mkdirSync(bin, { recursive: true })
  const cli = path.join(root, "dist", "cli.cjs")
  if (process.platform === "win32") {
    fs.writeFileSync(path.join(bin, "pgstrap.cmd"), `@node "${cli}" %*\r\n`)
  } else {
    fs.symlinkSync(cli, path.join(bin, "pgstrap"))
    fs.chmodSync(cli, 0o755)
  }
  return run([process.execPath, "run", "db:generate", ...args], ctx.cwd, {
    ...process.env,
    POSTGRES_URI: unavailable,
    PG_URI: unavailable,
    DATABASE_URL: unavailable,
  })
}

test("initialized bun run db:generate exits with real types and SQL, without PostgreSQL", async () => {
  const ctx = fixture()
  const result = await runScript(ctx)
  expect(result.code, result.stdout + result.stderr).toBe(0)
  expectArtifacts(ctx.dbDir)
}, 30000)

test("CLI --no-pglite preserves external database selection", async () => {
  const ctx = fixture()
  const result = await runScript(ctx, ["--no-pglite"])
  expect(result.code).not.toBe(0)
  expect(result.stdout + result.stderr).toContain("ECONNREFUSED")
  expect(fs.existsSync(path.join(ctx.dbDir, "zapatos", "schema.d.ts"))).toBe(
    false,
  )
}, 30000)

test("CLI exits on a migration failure without leaving an embedded server alive", async () => {
  const ctx = fixture()
  fs.writeFileSync(
    path.join(ctx.migrationsDir, "1700000000001_invalid.js"),
    "exports.up = () => { throw new Error('migration intentionally failed') }",
  )
  const result = await runScript(ctx)
  expect(result.code).not.toBe(0)
  expect(result.code).not.toBe(137)
  expect(result.stderr).toContain("migration intentionally failed")
}, 30000)
