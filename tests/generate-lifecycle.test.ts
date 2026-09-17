import { test, expect } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { initPgstrap } from "../src/init"
import { generate } from "../src/generate"

const root = path.resolve(import.meta.dir, "..")
const migration = `exports.up = async (pgm) => { pgm.createTable('generated_without_postgres', { id: 'id', label: { type: 'text', notNull: true } }) }; exports.down = async (pgm) => { pgm.dropTable('generated_without_postgres') };`
function tempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-lifecycle-"))
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "fixture" }),
  )
  const migrations = path.join(dir, "src/db/migrations")
  fs.mkdirSync(migrations, { recursive: true })
  fs.writeFileSync(
    path.join(migrations, "1710000000000_create_table.js"),
    migration,
  )
  return { dir, migrations, dbDir: path.join(dir, "src/db") }
}

test("initialized db:generate chooses PGlite without external Postgres", async () => {
  const f = tempProject()
  try {
    await initPgstrap({ cwd: f.dir })
    const pkg = JSON.parse(
      fs.readFileSync(path.join(f.dir, "package.json"), "utf8"),
    )
    expect(pkg.scripts["db:generate"]).toBe("pgstrap generate --pglite")
    const args = pkg.scripts["db:generate"].split(" ").slice(1)
    const proc = Bun.spawn(
      [process.execPath, path.join(root, "src/cli.ts"), ...args],
      {
        cwd: f.dir,
        env: {
          ...process.env,
          NODE_ENV: "test",
          DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/no_database",
          PGHOST: "127.0.0.1",
          PGPORT: "1",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const [code, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" })
    expect(
      fs.readFileSync(path.join(f.dbDir, "zapatos/schema.d.ts"), "utf8"),
    ).toContain("generated_without_postgres")
    expect(
      fs.existsSync(
        path.join(
          f.dbDir,
          "structure/public/tables/generated_without_postgres/table.sql",
        ),
      ),
    ).toBe(true)
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true })
  }
}, 20000)

test("generation failure restores DATABASE_URL after gateway startup", async () => {
  const f = tempProject()
  const previous = process.env.DATABASE_URL
  const sentinel =
    "postgres://fixture:fixture@127.0.0.1:1/preserve_this_setting"
  process.env.DATABASE_URL = sentinel
  fs.writeFileSync(
    path.join(f.dbDir, "structure"),
    "an intentional file, not a directory",
  )
  try {
    await expect(
      generate({
        schemas: ["public"],
        defaultDatabase: "unused",
        dbDir: f.dbDir,
        migrationsDir: f.migrations,
        pglite: true,
      }),
    ).rejects.toThrow()
    expect(process.env.DATABASE_URL).toBe(sentinel)
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previous
    fs.rmSync(f.dir, { recursive: true, force: true })
  }
}, 15000)

test("migration failure also finishes and preserves the environment", async () => {
  const f = tempProject()
  const before = process.env.DATABASE_URL
  fs.writeFileSync(
    path.join(f.migrations, "1710000000000_create_table.js"),
    "exports.up = async () => { throw Error('intentional fixture migration failure') };",
  )
  try {
    await expect(
      generate({
        schemas: ["public"],
        defaultDatabase: "unused",
        dbDir: f.dbDir,
        migrationsDir: f.migrations,
        pglite: true,
      }),
    ).rejects.toThrow("intentional fixture")
    expect(process.env.DATABASE_URL).toBe(before)
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true })
  }
}, 15000)
