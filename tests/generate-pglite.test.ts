import test from "ava"
import fs from "fs"
import path from "path"
import { generateWithPglite } from "../src/generate"

const migrationContent = `
  exports.up = async (pgm) => {
    pgm.createTable('foo', {
      id: 'id'
    })
  }
  exports.down = async (pgm) => {
    pgm.dropTable('foo')
  }
`

test("generateWithPglite creates structure", async (t) => {
  const cwd = fs.mkdtempSync(path.join(__dirname, "temp_proj"))
  const migrationsDir = path.join(cwd, "migrations")
  fs.mkdirSync(migrationsDir, { recursive: true })
  fs.writeFileSync(
    path.join(migrationsDir, "001_create_foo.cjs"),
    migrationContent,
  )

  await generateWithPglite({
    schemas: ["public"],
    defaultDatabase: "test_db",
    dbDir: path.join(cwd, "db"),
    migrationsDir,
    cwd,
  })

  const expected = path.join(cwd, "db/structure/public/tables/foo/table.sql")
  t.true(fs.existsSync(expected))

  fs.rmSync(cwd, { recursive: true, force: true })
})
