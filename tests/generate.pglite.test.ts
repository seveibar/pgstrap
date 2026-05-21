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

const makeProject = (): {
  tmp: string
  migrationsDir: string
  dbDir: string
} => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-generate-"))
  const migrationsDir = path.join(tmp, "migrations")
  const dbDir = path.join(tmp, "db")

  fs.mkdirSync(migrationsDir, { recursive: true })
  fs.writeFileSync(
    path.join(migrationsDir, "001_create_table.js"),
    migrationFile,
  )

  return {
    tmp,
    migrationsDir,
    dbDir,
  }
}

const expectGeneratedSchema = (tmp: string): void => {
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
}

test("generate defaults to pglite and dumps structure without a running postgres server", async () => {
  const { tmp, migrationsDir, dbDir } = makeProject()

  try {
    await generate({
      schemas: ["public"],
      defaultDatabase: "postgres",
      dbDir,
      migrationsDir,
    })

    expectGeneratedSchema(tmp)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test("generate with pglite runs migrations and dumps structure", async () => {
  const { tmp, migrationsDir, dbDir } = makeProject()

  try {
    await generate({
      schemas: ["public"],
      defaultDatabase: "postgres",
      dbDir,
      migrationsDir,
      pglite: true,
    })

    expectGeneratedSchema(tmp)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
