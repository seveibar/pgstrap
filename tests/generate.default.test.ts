import { test, expect, spyOn } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import fs from "fs"
import os from "os"
import path from "path"
import { generate } from "../src/generate"

const unavailableDatabase =
  "postgres://postgres:postgres@127.0.0.1:1/unavailable"
const cli = path.resolve(__dirname, "../src/cli.ts")
const databaseUriKeys = [
  "POSTGRES_URI",
  "PG_URI",
  "DATABASE_URL",
  "DATABASE_URI",
] as const

function fixture(migration = 'pgm.createTable("widgets", { id: "id" })') {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-default-"))
  const dbDir = path.join(cwd, "src/db")
  const migrationsDir = path.join(dbDir, "migrations")
  fs.mkdirSync(migrationsDir, { recursive: true })
  fs.writeFileSync(
    path.join(migrationsDir, "20240101000000_create_widgets.js"),
    `exports.up = async (pgm) => { ${migration} }`,
  )
  fs.writeFileSync(
    path.join(cwd, "pgstrap.config.js"),
    'module.exports = { defaultDatabase: "unavailable", schemas: ["public"] }',
  )
  return {
    cwd,
    dbDir,
    migrationsDir,
    schemas: ["public"],
    defaultDatabase: "unavailable",
  }
}

function expectArtifacts(dbDir: string) {
  expect(
    fs.readFileSync(path.join(dbDir, "zapatos/schema.d.ts"), "utf8"),
  ).toContain("widgets")
  expect(
    fs.readFileSync(
      path.join(dbDir, "structure/public/tables/widgets/table.sql"),
      "utf8",
    ),
  ).toContain("widgets")
}

async function runCli(cwd: string, ...args: string[]) {
  const child = Bun.spawn([process.execPath, cli, "generate", ...args], {
    cwd,
    env: {
      ...process.env,
      ...Object.fromEntries(
        databaseUriKeys.map((key) => [key, unavailableDatabase]),
      ),
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const timer = setTimeout(() => child.kill(), 20000)
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    return { stdout, stderr, exitCode }
  } finally {
    clearTimeout(timer)
  }
}

test("generate defaults to PGlite and restores every database URI alias", async () => {
  const ctx = fixture()
  const previousUris = databaseUriKeys.map((key) => process.env[key])
  for (const key of databaseUriKeys) process.env[key] = unavailableDatabase
  const close = spyOn(PGlite.prototype, "close")
  try {
    await generate(ctx)
    expectArtifacts(ctx.dbDir)
    for (const key of databaseUriKeys)
      expect(process.env[key]).toBe(unavailableDatabase)
    expect(close).toHaveBeenCalledTimes(1)
  } finally {
    close.mockRestore()
    databaseUriKeys.forEach((key, index) => {
      const previous = previousUris[index]
      if (previous === undefined) delete process.env[key]
      else process.env[key] = previous
    })
    fs.rmSync(ctx.cwd, { recursive: true, force: true })
  }
})

test("PGlite is closed when a migration fails", async () => {
  const ctx = fixture('throw new Error("deliberate migration failure")')
  const previous = process.env.DATABASE_URL
  const close = spyOn(PGlite.prototype, "close")
  try {
    await expect(generate(ctx)).rejects.toThrow("deliberate migration failure")
    expect(process.env.DATABASE_URL).toBe(previous)
    expect(close).toHaveBeenCalledTimes(1)
  } finally {
    close.mockRestore()
    fs.rmSync(ctx.cwd, { recursive: true, force: true })
  }
})

test("overlapping generation calls keep their schemas and DATABASE_URL separate", async () => {
  const first = fixture('pgm.createTable("first_only", { id: "id" })')
  const second = fixture('pgm.createTable("second_only", { id: "id" })')
  const previous = process.env.DATABASE_URL
  process.env.DATABASE_URL = unavailableDatabase
  try {
    await Promise.all([generate(first), generate(second)])
    for (const [ctx, ownTable, otherTable] of [
      [first, "first_only", "second_only"],
      [second, "second_only", "first_only"],
    ] as const) {
      const types = fs.readFileSync(
        path.join(ctx.dbDir, "zapatos/schema.d.ts"),
        "utf8",
      )
      expect(types).toContain(ownTable)
      expect(types).not.toContain(otherTable)
      expect(
        fs.existsSync(
          path.join(
            ctx.dbDir,
            "structure/public/tables",
            ownTable,
            "table.sql",
          ),
        ),
      ).toBe(true)
      expect(
        fs.existsSync(
          path.join(ctx.dbDir, "structure/public/tables", otherTable),
        ),
      ).toBe(false)
    }
    expect(process.env.DATABASE_URL).toBe(unavailableDatabase)
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previous
    fs.rmSync(first.cwd, { recursive: true, force: true })
    fs.rmSync(second.cwd, { recursive: true, force: true })
  }
})

test("generate CLI succeeds without Postgres and --no-pglite opts out", async () => {
  const ctx = fixture()
  const external = fixture()
  try {
    const result = await runCli(ctx.cwd)
    expect(result.exitCode).toBe(0)
    expectArtifacts(ctx.dbDir)

    const optedOut = await runCli(external.cwd, "--no-pglite")
    expect(optedOut.exitCode).not.toBe(0)
    expect(optedOut.stdout + optedOut.stderr).toContain("ECONNREFUSED")
    expect(
      fs.existsSync(path.join(external.dbDir, "zapatos/schema.d.ts")),
    ).toBe(false)
  } finally {
    fs.rmSync(ctx.cwd, { recursive: true, force: true })
    fs.rmSync(external.cwd, { recursive: true, force: true })
  }
})

test("generate CLI exits after a dump failure", async () => {
  const ctx = fixture()
  fs.writeFileSync(path.join(ctx.dbDir, "structure"), "not a directory")
  try {
    const result = await runCli(ctx.cwd)
    expect(result.exitCode).not.toBe(0)
    expect(result.exitCode).not.toBe(137)
    expect(result.stdout + result.stderr).toMatch(/ENOTDIR|EEXIST/)
  } finally {
    fs.rmSync(ctx.cwd, { recursive: true, force: true })
  }
})
