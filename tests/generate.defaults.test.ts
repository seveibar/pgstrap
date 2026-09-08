import { test, expect } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { generate } from "../src/generate"

const migrationFile = `
exports.up = async (pgm) => {
  pgm.createTable('foo', { id: 'id' })
  }
  `

const envKeys = ["DATABASE_URL", "POSTGRES_URI", "PG_URI"] as const

test("generate defaults to PGlite and restores database environment", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-default-generate-"))
    const migrationsDir = path.join(tmp, "migrations")
    fs.mkdirSync(migrationsDir, { recursive: true })
    fs.writeFileSync(path.join(migrationsDir, "001_create_table.js"), migrationFile)

       const previous = Object.fromEntries(
             envKeys.map((key) => [key, process.env[key]]),
           ) as Record<(typeof envKeys)[number], string | undefined>
       const sentinels = Object.fromEntries(
             envKeys.map((key) => [key, `sentinel-${key}`]),
           ) as Record<(typeof envKeys)[number], string>
    for (const key of envKeys) process.env[key] = sentinels[key]

       try {
             await generate({
                     schemas: ["public"],
                     defaultDatabase: "postgres",
                     dbDir: path.join(tmp, "db"),
                     migrationsDir,
             })

      expect(fs.existsSync(path.join(tmp, "db", "zapatos", "schema.d.ts"))).toBe(true)
             expect(
                     fs.existsSync(path.join(tmp, "db", "structure", "public", "tables", "foo", "table.sql")),
                   ).toBe(true)
       } finally {
             for (const key of envKeys) expect(process.env[key]).toBe(sentinels[key])
             for (const key of envKeys) {
                     if (previous[key] === undefined) delete process.env[key]
                     else process.env[key] = previous[key]
             }
             fs.rmSync(tmp, { recursive: true, force: true })
       }
})
