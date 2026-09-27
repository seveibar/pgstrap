import { test, expect } from "bun:test"
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

test("generate with pglite runs migrations and dumps structure", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-generate-"))
  const migrationsDir = path.join(tmp, "migrations")
  fs.mkdirSync(migrationsDir, { recursive: true })
  fs.writeFileSync(
    path.join(migrationsDir, "001_create_table.js"),
    migrationFile,
  )

  await generate({
    schemas: ["public"],
    defaultDatabase: "postgres",
    dbDir: path.join(tmp, "db"),
    migrationsDir,
    pglite: true,
  })

  const zapatosFile = path.join(tmp, "db", "zapatos", "schema.d.ts")
  const structureDir = path.join(
    tmp,
    "db",
    "structure",
    "public",
    "tables",
    "foo",
  )

  expect(fs.existsSync(zapatosFile)).toBe(true)
  expect(fs.existsSync(path.join(structureDir, "table.sql"))).toBe(true)

  fs.rmSync(tmp, { recursive: true, force: true })
})

test.each([undefined, "postgres://unused:unused@127.0.0.1:1/unreachable"])(
  "failed generation restores DATABASE_URL (%s)",
  async (databaseUrl) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-failure-"))
    const previous = process.env.DATABASE_URL
    try {
      if (databaseUrl === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = databaseUrl
      const migrationsDir = path.join(tmp, "migrations")
      fs.mkdirSync(migrationsDir)
      fs.writeFileSync(
        path.join(migrationsDir, "001_create_table.js"),
        migrationFile,
      )
      fs.writeFileSync(path.join(tmp, "zapatos"), "not a directory")
      await expect(
        generate({
          schemas: ["public"],
          defaultDatabase: "postgres",
          dbDir: tmp,
          migrationsDir,
          pglite: true,
        }),
      ).rejects.toThrow("EEXIST")
      expect(process.env.DATABASE_URL).toBe(databaseUrl)
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = previous
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  },
)

test("concurrent offline generations keep separate schemas and parent environment", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-concurrent-"))
  const previous = process.env.DATABASE_URL
  const databaseUrl = "postgres://unused:unused@127.0.0.1:1/unreachable"
  process.env.DATABASE_URL = databaseUrl
  const observed: Array<string | undefined> = []
  const observer = setInterval(() => observed.push(process.env.DATABASE_URL), 5)
  try {
    await Promise.all(
      ["first", "second"].map(async (name) => {
        const directory = path.join(tmp, name)
        const migrationsDir = path.join(directory, "migrations")
        fs.mkdirSync(migrationsDir, { recursive: true })
        fs.writeFileSync(
          path.join(migrationsDir, "001_create_table.js"),
          `exports.up = pgm => pgm.createTable('${name}', { id: 'id' })`,
        )
        await generate({
          schemas: ["public"],
          defaultDatabase: "postgres",
          dbDir: directory,
          migrationsDir,
          pglite: true,
        })
        expect(
          fs.readFileSync(
            path.join(directory, `structure/public/tables/${name}/table.sql`),
            "utf8",
          ),
        ).toContain(`public.${name}`)
        const otherName = name === "first" ? "second" : "first"
        expect(
          fs.existsSync(
            path.join(directory, `structure/public/tables/${otherName}`),
          ),
        ).toBe(false)
      }),
    )
    expect(observed.length).toBeGreaterThan(0)
    expect(observed.every((value) => value === databaseUrl)).toBe(true)
    expect(process.env.DATABASE_URL).toBe(databaseUrl)
  } finally {
    clearInterval(observer)
    if (previous === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previous
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}, 30_000)
