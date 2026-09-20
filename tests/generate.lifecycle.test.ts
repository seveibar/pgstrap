import { test, expect } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { generate } from "../src/generate"

const connectionKeys = [
  "POSTGRES_URI",
  "PG_URI",
  "DATABASE_URL",
  "DATABASE_URI",
]

for (const mode of ["success", "migration", "dump"]) {
  test(`PGlite restores connection settings after ${mode}`, async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-lifecycle-"))
    const before = connectionKeys.map((key) => process.env[key])
    try {
      connectionKeys.forEach((key, index) => {
        if (index % 2) delete process.env[key]
        else
          process.env[key] =
            `postgres://fixture:unused@127.0.0.1:1/preserve_${index}`
      })
      const expected = connectionKeys.map((key) => process.env[key])
      const migrations = path.join(cwd, "migrations")
      fs.mkdirSync(migrations)
      fs.writeFileSync(
        path.join(migrations, "1700000000000_create.cjs"),
        mode === "migration"
          ? 'exports.up = () => { throw new Error("fixture migration failure") }'
          : 'exports.up = pgm => pgm.createTable("lifecycle_widget", { id: "id" })',
      )
      if (mode === "dump")
        fs.writeFileSync(path.join(cwd, "structure"), "blocked")
      const result = generate({
        schemas: ["public"],
        defaultDatabase: "unused",
        dbDir: cwd,
        migrationsDir: migrations,
        pglite: true,
      })
      if (mode === "success") await result
      else
        await expect(result).rejects.toThrow(
          mode === "migration" ? "fixture migration failure" : "EEXIST",
        )
      expect(connectionKeys.map((key) => process.env[key])).toEqual(expected)
    } finally {
      connectionKeys.forEach((key, index) => {
        if (before[index] === undefined) delete process.env[key]
        else process.env[key] = before[index]
      })
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  }, 15000)
}
