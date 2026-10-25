import { afterEach, expect, spyOn, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import fs from "fs"
import net from "node:net"
import os from "os"
import path from "path"
import { generate } from "../src/generate"
import { initPgstrap } from "../src/init"

const migrationFile = `
exports.up = async (pgm) => {
  pgm.createTable('foo', { id: 'id', name: { type: 'text', notNull: true } })
}
`
const originalDbUrl = process.env.DATABASE_URL
const projects: string[] = []

afterEach(() => {
  if (originalDbUrl === undefined) delete process.env.DATABASE_URL
  else process.env.DATABASE_URL = originalDbUrl
  for (const project of projects.splice(0)) {
    fs.rmSync(project, { recursive: true, force: true })
  }
})

function fixture(migration = migrationFile) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-generate-"))
  projects.push(root)
  const dbDir = path.join(root, "src", "db")
  const migrationsDir = path.join(dbDir, "migrations")
  fs.mkdirSync(migrationsDir, { recursive: true })
  fs.writeFileSync(path.join(root, "package.json"), '{"name":"fixture"}')
  fs.writeFileSync(
    path.join(migrationsDir, "1740000000000_create_table.js"),
    migration,
  )
  return { root, dbDir, migrationsDir }
}

function expectGenerated(dbDir: string) {
  const schema = fs.readFileSync(
    path.join(dbDir, "zapatos", "schema.d.ts"),
    "utf8",
  )
  const sql = fs.readFileSync(
    path.join(dbDir, "structure", "public", "tables", "foo", "table.sql"),
    "utf8",
  )
  expect(schema).toContain("namespace foo")
  expect(schema).toContain("name: string")
  expect(sql).toMatch(/CREATE TABLE\s+public\.foo/)
  expect(sql).toContain("name text NOT NULL")
}

for (const previousUrl of [
  undefined,
  "postgres://invalid:invalid@127.0.0.1:1/not_running",
]) {
  test(`generate defaults to PGlite and restores DATABASE_URL (${previousUrl === undefined ? "unset" : "set"})`, async () => {
    const { dbDir, migrationsDir } = fixture()
    if (previousUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousUrl

    await generate({
      schemas: ["public"],
      defaultDatabase: "not_running",
      dbDir,
      migrationsDir,
    })

    expectGenerated(dbDir)
    expect(process.env.DATABASE_URL).toBe(previousUrl)
  }, 60000)
}

test("failed migrations close the owned PGlite database without changing DATABASE_URL", async () => {
  const { dbDir, migrationsDir } = fixture(
    `exports.up = () => { throw new Error('migration failed deliberately') }`,
  )
  const previousUrl = "postgres://original:original@127.0.0.1:1/original"
  process.env.DATABASE_URL = previousUrl
  const close = spyOn(PGlite.prototype, "close")

  try {
    await expect(
      generate({
        schemas: ["public"],
        defaultDatabase: "unused",
        dbDir,
        migrationsDir,
      }),
    ).rejects.toThrow("migration failed deliberately")
    expect(close).toHaveBeenCalledTimes(1)
    expect(close.mock.contexts[0].closed).toBe(true)
    expect(process.env.DATABASE_URL).toBe(previousUrl)
  } finally {
    close.mockRestore()
  }
}, 60000)

for (const stage of ["types", "structure"]) {
  test(`${stage} output failure closes the gateway and PGlite and restores DATABASE_URL`, async () => {
    const { root, dbDir: defaultDbDir, migrationsDir } = fixture()
    const dbDir =
      stage === "types" ? path.join(root, "not-a-directory") : defaultDbDir
    fs.writeFileSync(
      stage === "types" ? dbDir : path.join(dbDir, "structure"),
      "occupied",
    )
    const previousUrl = "postgres://original:original@127.0.0.1:1/original"
    process.env.DATABASE_URL = previousUrl
    const listen = spyOn(net.Server.prototype, "listen")
    const close = spyOn(PGlite.prototype, "close")

    try {
      await expect(
        generate({
          schemas: ["public"],
          defaultDatabase: "unused",
          dbDir,
          migrationsDir,
        }),
      ).rejects.toThrow()
      expect(listen).toHaveBeenCalledTimes(1)
      const server = listen.mock.contexts[0]
      expect(server.listening).toBe(false)
      expect(server.address()).toBeNull()
      expect(close).toHaveBeenCalledTimes(1)
      expect(close.mock.contexts[0].closed).toBe(true)
      expect(process.env.DATABASE_URL).toBe(previousUrl)
    } finally {
      listen.mockRestore()
      close.mockRestore()
    }
  }, 60000)
}

async function runCli(root: string, args: string[]) {
  const proc = Bun.spawn(
    [process.execPath, path.join(import.meta.dir, "../src/cli.ts"), ...args],
    {
      cwd: root,
      env: {
        ...process.env,
        DATABASE_URL: "postgres://invalid:invalid@127.0.0.1:1/not_running",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { stdout, stderr, exitCode }
}

test("the default generate CLI works without an external Postgres server", async () => {
  const { root, dbDir } = fixture()
  await initPgstrap({ cwd: root })
  const result = await runCli(root, ["generate"])
  expect(result.exitCode).toBe(0)
  expectGenerated(dbDir)
}, 60000)

test("--no-pglite uses the external database instead of applying migrations", async () => {
  const { root, dbDir } = fixture(
    `exports.up = () => { throw new Error('unexpected in-memory migration') }`,
  )
  await initPgstrap({ cwd: root })
  const result = await runCli(root, ["generate", "--no-pglite"])
  expect(result.exitCode).not.toBe(0)
  expect(result.stdout + result.stderr).toContain("ECONNREFUSED")
  expect(result.stdout + result.stderr).not.toContain(
    "unexpected in-memory migration",
  )
  expect(fs.existsSync(path.join(dbDir, "zapatos"))).toBe(false)
}, 60000)

test("a scaffolded bun run db:generate works without Postgres", async () => {
  const { root, dbDir } = fixture()
  await initPgstrap({ cwd: root })
  const binDir = path.join(root, "node_modules", ".bin")
  fs.mkdirSync(binDir, { recursive: true })
  // Use the source CLI as the local executable, without relying on a prior build.
  fs.writeFileSync(
    path.join(binDir, "pgstrap"),
    `#!${process.execPath}\nimport ${JSON.stringify(path.join(import.meta.dir, "../src/cli.ts"))}\n`,
    { mode: 0o755 },
  )
  const proc = Bun.spawn([process.execPath, "run", "db:generate"], {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ""}`,
      DATABASE_URL: "postgres://invalid:invalid@127.0.0.1:1/not_running",
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  expect({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }).toEqual({
    exitCode: 0,
    output: "",
  })
  expectGenerated(dbDir)
}, 60000)
