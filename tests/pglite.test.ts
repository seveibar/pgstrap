import { PGlite } from "@electric-sql/pglite"
import test from "ava"
import { migrate } from "../src/migrate"
import fs from "fs"
import path from "path"

test("migration of a pglite db works", async (t) => {
  const client = new PGlite()

  // Create a temporary migration file
  const migrationsDir = path.join(__dirname, "temp_migrations")
  fs.mkdirSync(migrationsDir, { recursive: true })
  const migrationContent = `
    exports.up = async (pgm) => {
      pgm.createTable('test_table', {
        id: 'id',
        name: { type: 'varchar(255)', notNull: true },
        created_at: {
          type: 'timestamp',
          notNull: true,
          default: pgm.func('current_timestamp'),
        },
      })
    }

    exports.down = async (pgm) => {
      pgm.dropTable('test_table')
    }
  `
  fs.writeFileSync(
    path.join(migrationsDir, "001_create_test_table.js"),
    migrationContent,
  )

  // Run migrations
  await migrate({
    client: client as any,
    defaultDatabase: "test_db",
    migrationsDir,
    cwd: __dirname,
    schemas: ["public"],
  })

  // Verify that the table was created
  const result = await client.query("SELECT * FROM test_table")
  t.is(result.fields.length, 3, "Table should have 3 columns")
  t.deepEqual(
    result.fields.map((f) => f.name),
    ["id", "name", "created_at"],
    "Table should have correct column names",
  )

  // Clean up
  fs.rmSync(migrationsDir, { recursive: true, force: true })
})
