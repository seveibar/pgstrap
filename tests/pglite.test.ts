import { PGlite } from "@electric-sql/pglite"
import { test, expect } from "bun:test"
import { migrate } from "../src/migrate"
import fs from "fs"
import path from "path"

test("migration of a pglite db works", async () => {
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
  expect(result.fields.length).toBe(3)
  expect(result.fields.map((f) => f.name)).toEqual(["id", "name", "created_at"])

  // Clean up
  fs.rmSync(migrationsDir, { recursive: true, force: true })
})
