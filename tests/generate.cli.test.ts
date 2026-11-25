import { expect, test } from "bun:test"
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { initPgstrap } from "../src/init"

test("the initialized db:generate script uses migrations without PostgreSQL", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "pgstrap-cli-"))
  try {
    writeFileSync(path.join(cwd, "package.json"), "{}")
    await initPgstrap({ cwd })
    const bin = path.join(cwd, "node_modules/.bin")
    mkdirSync(bin, { recursive: true })
    // Exercise the scaffold's script against the source CLI before packaging.
    writeFileSync(
      path.join(bin, "pgstrap"),
      `#!/bin/sh\nexec "$BUN_BIN" "$PGSTRAP_CLI" "$@"\n`,
      { mode: 0o755 },
    )
    const db = path.join(cwd, "src/db")
    const migrations = path.join(db, "migrations")
    mkdirSync(migrations)
    writeFileSync(
      path.join(migrations, "1700000000000_create_widgets.js"),
      "exports.up = pgm => pgm.createTable('widgets', { id: 'id' })",
    )
    const cmd = Bun.spawn([process.execPath, "run", "db:generate"], {
      cwd,
      env: {
        ...process.env,
        BUN_BIN: process.execPath,
        PGSTRAP_CLI: path.resolve(import.meta.dir, "../src/cli.ts"),
        POSTGRES_URI: "postgres://postgres@127.0.0.1:1/unreachable",
      },
      stderr: "pipe",
      stdout: "ignore",
    })
    const errors = await new Response(cmd.stderr).text()
    expect(await cmd.exited, errors).toBe(0)
    expect(
      readFileSync(path.join(db, "zapatos/schema.d.ts"), "utf8"),
    ).toContain("widgets")
    expect(
      readFileSync(
        path.join(db, "structure/public/tables/widgets/table.sql"),
        "utf8",
      ),
    ).toContain("widgets")
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}, 30000)
