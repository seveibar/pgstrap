import { test, expect } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { execSync } from "child_process"

const migrationFile = `
exports.up = async (pgm) => {
  pgm.createTable('cli_test_table', { id: 'id' })
}
exports.down = async (pgm) => {
  pgm.dropTable('cli_test_table')
}
`

test("cli generate runs with pglite by default without postgres", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-cli-test-"))
  const dbDir = path.join(tmp, "src", "db")
  const migrationsDir = path.join(dbDir, "migrations")
  fs.mkdirSync(migrationsDir, { recursive: true })
  fs.writeFileSync(path.join(migrationsDir, "001_cli_table.js"), migrationFile)
  fs.writeFileSync(
    path.join(tmp, "package.json"),
    JSON.stringify({ name: "cli-test-pkg" }),
  )
  fs.writeFileSync(
    path.join(tmp, "pgstrap.config.js"),
    `module.exports = { defaultDatabase: "test_db", schemas: ["public"] }`,
  )

  const cliPath = path.resolve(__dirname, "../src/cli.ts")

  // Run cli generate using bun without --pglite argument (relying on default: true)
  execSync(`bun ${cliPath} generate`, {
    cwd: tmp,
    env: {
      ...process.env,
      // Ensure no DATABASE_URL is pointing to a live DB
      DATABASE_URL: "",
    },
    stdio: "pipe",
  })

  const zapatosFile = path.join(dbDir, "zapatos", "schema.d.ts")
  const structureDir = path.join(
    dbDir,
    "structure",
    "public",
    "tables",
    "cli_test_table",
  )

  expect(fs.existsSync(zapatosFile)).toBe(true)
  expect(fs.existsSync(path.join(structureDir, "table.sql"))).toBe(true)

  fs.rmSync(tmp, { recursive: true, force: true })
}, 30000)
