import { test, expect } from "bun:test"
import { buildSync } from "esbuild"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { initPgstrap } from "../src/init"

test("initialized db:generate produces types and SQL without PostgreSQL", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-offline-"))
  try {
    fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"offline-test"}')
    await initPgstrap({ cwd: tmp })
    const migrations = path.join(tmp, "src/db/migrations")
    fs.mkdirSync(migrations, { recursive: true })
    fs.writeFileSync(
      path.join(migrations, "001_widgets.js"),
      `exports.up = (pgm) => pgm.createTable("widgets", {
        id: "id", label: { type: "text", notNull: true }
      })`,
    )
    fs.symlinkSync(
      path.resolve(import.meta.dir, "../node_modules"),
      path.join(tmp, "node_modules"),
      "junction",
    )
    const binDir = path.join(tmp, "bin")
    const cli = path.join(binDir, "pgstrap")
    buildSync({
      entryPoints: [path.resolve(import.meta.dir, "../src/cli.ts")],
      outfile: cli,
      bundle: true,
      platform: "node",
      format: "cjs",
      packages: "external",
    })
    fs.chmodSync(cli, 0o755)
    const result = spawnSync(process.execPath, ["run", "db:generate"], {
      cwd: tmp,
      encoding: "utf8",
      timeout: 30000,
      env: {
        PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
        NODE_ENV: "test",
        DATABASE_URL: "postgres://unavailable:unavailable@127.0.0.1:1/offline",
      },
    })
    expect(result.error).toBeUndefined()
    if (result.status !== 0) {
      throw new Error(`db:generate failed:\n${result.stdout}\n${result.stderr}`)
    }
    expect(result.status).toBe(0)
    expect(
      fs.readFileSync(path.join(tmp, "src/db/zapatos/schema.d.ts"), "utf8"),
    ).toContain("widgets")
    expect(
      fs.readFileSync(
        path.join(tmp, "src/db/structure/public/tables/widgets/table.sql"),
        "utf8",
      ),
    ).toContain("label")
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}, 40000)
