import { test, expect } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { buildSync } from "esbuild"
import { initPgstrap } from "../src/init"

test("initialized db:generate works without external PostgreSQL", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-offline-"))
  try {
    fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"offline-test"}')
    await initPgstrap({ cwd: tmp })
    const migrations = path.join(tmp, "src/db/migrations")
    fs.mkdirSync(migrations, { recursive: true })
    fs.writeFileSync(
      path.join(migrations, "001_create_table.js"),
      "exports.up = (pgm) => pgm.createTable('offline_example', { id: 'id' })",
    )

    // Match the distributed CommonJS CLI while resolving installed dependencies.
    fs.symlinkSync(
      path.resolve(import.meta.dir, "../node_modules"),
      path.join(tmp, "node_modules"),
      "dir",
    )
    const bin = path.join(tmp, "bin")
    fs.mkdirSync(bin)
    const executable = path.join(bin, "pgstrap")
    buildSync({
      entryPoints: [path.resolve(import.meta.dir, "../src/cli.ts")],
      outfile: executable,
      bundle: true,
      platform: "node",
      format: "cjs",
      packages: "external",
    })
    fs.chmodSync(executable, 0o755)
    const result = Bun.spawnSync([process.execPath, "run", "db:generate"], {
      cwd: tmp,
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:1/unavailable",
      },
      timeout: 20000,
    })
    expect(result.stderr.toString() + result.stdout.toString()).not.toContain(
      "ECONNREFUSED",
    )
    expect({
      exitCode: result.exitCode,
      stderr: result.exitCode ? result.stderr.toString() : "",
    }).toEqual({ exitCode: 0, stderr: "" })
    expect(
      fs.readFileSync(path.join(tmp, "src/db/zapatos/schema.d.ts"), "utf8"),
    ).toContain("offline_example")
    expect(
      fs.readFileSync(
        path.join(
          tmp,
          "src/db/structure/public/tables/offline_example/table.sql",
        ),
        "utf8",
      ),
    ).toContain("offline_example")
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}, 30000)
