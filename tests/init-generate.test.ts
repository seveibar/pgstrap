import { beforeAll, test, expect } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { spawnSync } from "child_process"
import { initPgstrap } from "../src/init"

const repoDir = path.resolve(import.meta.dir, "..")

beforeAll(() => {
  const result = spawnSync(process.execPath, ["run", "build"], {
    cwd: repoDir,
    encoding: "utf8",
    timeout: 45_000,
  })
  if (result.error || result.status !== 0) {
    throw new Error(`CLI build failed: ${result.error ?? result.stderr}`)
  }
}, 60_000)

test("initialized db:generate creates types without a PostgreSQL server", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-init-generate-"))
  try {
    fs.writeFileSync(
      path.join(cwd, "package.json"),
      JSON.stringify({ name: "fixture" }),
    )
    await initPgstrap({ cwd })

    const migrationsDir = path.join(cwd, "src", "db", "migrations")
    fs.mkdirSync(migrationsDir, { recursive: true })
    fs.writeFileSync(
      path.join(migrationsDir, "001_create_widget.js"),
      `exports.up = (pgm) => {
        pgm.createTable("widgets", {
          id: "id",
          name: { type: "text", notNull: true },
        })
      }`,
    )

    const pkg = JSON.parse(
      fs.readFileSync(path.join(cwd, "package.json"), "utf8"),
    )
    const [command, ...args] = pkg.scripts["db:generate"].split(" ")
    expect(command).toBe("pgstrap")

    // Run the generated script's arguments through the real CLI in a fresh process.
    const result = spawnSync(
      process.execPath,
      [path.join(repoDir, "dist", "cli.cjs"), ...args],
      {
        cwd,
        env: {
          ...process.env,
          DATABASE_URL:
            "postgres://unavailable:unavailable@127.0.0.1:1/unavailable",
          PGHOST: "127.0.0.1",
          PGPORT: "1",
          PGDATABASE: "unavailable",
          PGUSER: "unavailable",
          PGPASSWORD: "unavailable",
        },
        encoding: "utf8",
        timeout: 45_000,
      },
    )
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)

    const dbDir = path.join(cwd, "src", "db")
    const types = fs.readFileSync(
      path.join(dbDir, "zapatos", "schema.d.ts"),
      "utf8",
    )
    expect(types).toContain("widgets")
    expect(types).toContain("name")
    const sql = fs.readFileSync(
      path.join(dbDir, "structure", "public", "tables", "widgets", "table.sql"),
      "utf8",
    )
    expect(sql).toContain("widgets")
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true })
  }
}, 60_000)
