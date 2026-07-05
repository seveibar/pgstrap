import { test, expect } from "bun:test"
import { spawnSync } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"

const migrationFile = `
exports.up = async (pgm) => {
  pgm.createTable('widgets', { id: 'id', name: { type: 'text' } })
}
exports.down = async (pgm) => {
  pgm.dropTable('widgets')
}
`

// Regression test for https://github.com/seveibar/pgstrap/issues/2
// Running "pgstrap generate" (i.e. the scaffolded "db:generate" script)
// with no flags must succeed without a running Postgres server, because
// it defaults to an in-memory PGlite database.
test(
  "pgstrap generate defaults to pglite and works without postgres",
  async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-cli-generate-"))
    try {
      fs.writeFileSync(
        path.join(tmp, "pgstrap.config.js"),
        `module.exports = ${JSON.stringify({
          defaultDatabase: "some_db_that_does_not_exist",
          schemas: ["public"],
        })}`,
      )
      const migrationsDir = path.join(tmp, "src", "db", "migrations")
      fs.mkdirSync(migrationsDir, { recursive: true })
      fs.writeFileSync(
        path.join(migrationsDir, "001_create_widgets.js"),
        migrationFile,
      )

      const env = { ...process.env }
      // Make sure no real postgres connection info leaks into the test
      delete env.DATABASE_URL
      delete env.PGHOST
      delete env.PGPORT
      delete env.PGUSER
      delete env.PGPASSWORD
      delete env.PGDATABASE
      // Point at a port where nothing is listening so a fallback to a real
      // postgres connection would fail loudly
      env.PGPORT = "54329"

      const result = spawnSync(
        process.execPath,
        [path.join(__dirname, "..", "src", "cli.ts"), "generate"],
        { cwd: tmp, env, encoding: "utf8" },
      )

      expect(result.status).toBe(0)

      const zapatosFile = path.join(tmp, "src", "db", "zapatos", "schema.d.ts")
      const structureFile = path.join(
        tmp,
        "src",
        "db",
        "structure",
        "public",
        "tables",
        "widgets",
        "table.sql",
      )
      expect(fs.existsSync(zapatosFile)).toBe(true)
      expect(fs.existsSync(structureFile)).toBe(true)
      expect(fs.readFileSync(zapatosFile, "utf8")).toContain("widgets")
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  },
  60_000,
)
