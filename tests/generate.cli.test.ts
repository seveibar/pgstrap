import { test, expect } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"

test("generate defaults to PGlite without a running PostgreSQL server", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-cli-"))
  const dbDir = path.join(tmp, "db")
  const migrationsDir = path.join(dbDir, "migrations")
  fs.mkdirSync(migrationsDir, { recursive: true })
  fs.writeFileSync(
    path.join(tmp, "pgstrap.config.js"),
    `module.exports = ${JSON.stringify({ schemas: ["public"], defaultDatabase: "postgres", dbDir })}`,
  )
  fs.writeFileSync(
    path.join(migrationsDir, "001_create_table.js"),
    `exports.up = (pgm) => pgm.createTable("cli_items", { id: "id" })\nexports.down = (pgm) => pgm.dropTable("cli_items")`,
  )

  const child = Bun.spawn(
    [
      process.execPath,
      "run",
      path.join(import.meta.dir, "../src/cli.ts"),
      "generate",
    ],
    {
      cwd: tmp,
      env: {
        ...process.env,
        DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:1/postgres",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  )

  const timeout = setTimeout(() => child.kill(), 45_000)
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect({ exitCode, stdout, stderr }).toMatchObject({ exitCode: 0 })
    expect(fs.existsSync(path.join(dbDir, "zapatos", "schema.d.ts"))).toBe(true)
    expect(
      fs.readFileSync(path.join(dbDir, "zapatos", "schema.d.ts"), "utf8"),
    ).toContain("cli_items")
    expect(
      fs.existsSync(
        path.join(
          dbDir,
          "structure",
          "public",
          "tables",
          "cli_items",
          "table.sql",
        ),
      ),
    ).toBe(true)
    expect(
      fs.readFileSync(
        path.join(
          dbDir,
          "structure",
          "public",
          "tables",
          "cli_items",
          "table.sql",
        ),
        "utf8",
      ),
    ).toContain("cli_items")
  } finally {
    clearTimeout(timeout)
    child.kill()
    const resolved = path.resolve(tmp)
    if (
      !resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) ||
      !path.basename(resolved).startsWith("pgstrap-cli-")
    ) {
      throw new Error("Unexpected temporary directory")
    }
    fs.rmSync(resolved, { recursive: true, force: true })
  }
}, 60_000)
