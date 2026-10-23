import { afterEach, expect, spyOn, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { generate } from "../src/generate"

const migrationFile = `
exports.up = async (pgm) => {
  pgm.createTable('foo', { id: 'id' })
}
exports.down = async (pgm) => {
  pgm.dropTable('foo')
}
`

const PG_ENV_VARS = [
  "DATABASE_URL",
  "PGHOST",
  "PGUSER",
  "PGPASSWORD",
  "PGDATABASE",
  "PGPORT",
]

const scrubPgEnv = () => {
  const saved: Record<string, string | undefined> = {}
  for (const key of PG_ENV_VARS) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
  return saved
}

const restorePgEnv = (saved: Record<string, string | undefined>) => {
  for (const key of PG_ENV_VARS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]!
  }
}

const writeMigrationProject = (tmp: string) => {
  const migrationsDir = path.join(tmp, "migrations")
  fs.mkdirSync(migrationsDir, { recursive: true })
  fs.writeFileSync(
    path.join(migrationsDir, "001_create_table.js"),
    migrationFile,
  )
  return migrationsDir
}

test("generate defaults to pglite and needs no postgres (issue #2)", async () => {
  const saved = scrubPgEnv()
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-default-pglite-"))
  try {
    const migrationsDir = writeMigrationProject(tmp)

    await generate({
      schemas: ["public"],
      defaultDatabase: "postgres",
      dbDir: path.join(tmp, "db"),
      migrationsDir,
    })

    expect(fs.existsSync(path.join(tmp, "db", "zapatos", "schema.d.ts"))).toBe(
      true,
    )
    expect(
      fs.existsSync(
        path.join(
          tmp,
          "db",
          "structure",
          "public",
          "tables",
          "foo",
          "table.sql",
        ),
      ),
    ).toBe(true)
  } finally {
    restorePgEnv(saved)
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}, 60_000)

test("generate warns when default pglite ignores a configured DATABASE_URL", async () => {
  const saved = scrubPgEnv()
  process.env.DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:1/postgres"
  const logSpy = spyOn(console, "log")
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-pglite-notice-"))
  try {
    const migrationsDir = writeMigrationProject(tmp)

    await generate({
      schemas: ["public"],
      defaultDatabase: "postgres",
      dbDir: path.join(tmp, "db"),
      migrationsDir,
    })

    const logged = logSpy.mock.calls.map((args) => args.join(" ")).join("\n")
    expect(logged).toContain("in-memory PGlite")
    expect(logged).toContain("DATABASE_URL")
    expect(logged).toContain("--no-pglite")
  } finally {
    logSpy.mockRestore()
    restorePgEnv(saved)
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}, 60_000)

test("pgstrap generate (what db:generate runs) works without postgres (issue #2)", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-cli-generate-"))
  try {
    fs.writeFileSync(
      path.join(tmp, "pgstrap.config.js"),
      'export default { defaultDatabase: "postgres", schemas: ["public"] }\n',
    )
    const migrationsDir = path.join(tmp, "src", "db", "migrations")
    fs.mkdirSync(migrationsDir, { recursive: true })
    fs.writeFileSync(
      path.join(migrationsDir, "001_create_table.js"),
      migrationFile,
    )

    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (PG_ENV_VARS.includes(key) || value === undefined) continue
      env[key] = value
    }

    const distCli = path.join(__dirname, "..", "dist", "cli.cjs")
    if (!fs.existsSync(distCli)) {
      const build = Bun.spawn(["bun", "run", "build"], {
        cwd: path.join(__dirname, ".."),
        stdout: "pipe",
        stderr: "pipe",
      })
      expect(await build.exited).toBe(0)
    }
    const proc = Bun.spawn(["node", distCli, "generate"], {
      cwd: tmp,
      env,
      stdout: "pipe",
      stderr: "pipe",
    })
    const exitCode = await proc.exited
    const stderr = await new Response(proc.stderr).text()

    expect(exitCode).toBe(0)
    expect(stderr).not.toContain("ECONNREFUSED")
    expect(
      fs.existsSync(path.join(tmp, "src", "db", "zapatos", "schema.d.ts")),
    ).toBe(true)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}, 120_000)

afterEach(() => {})
