import { test, expect } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { initPgstrap } from "../src/init"

const cli = path.resolve(import.meta.dir, "../src/cli.ts")
const generateModule = path.resolve(import.meta.dir, "../src/generate.ts")
const unreachable = "postgres://nobody:invalid@127.0.0.1:1/unavailable"

for (const mode of ["default", "explicit", "external", "failure"] as const) {
  test(`generated db:generate script: ${mode}`, async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-offline-"))
    try {
      fs.writeFileSync(path.join(cwd, "package.json"), '{"name":"fixture"}')
      await initPgstrap({ cwd })
      const migrations = path.join(cwd, "src/db/migrations")
      fs.mkdirSync(migrations, { recursive: true })
      fs.writeFileSync(
        path.join(migrations, "1700000000000_create_widgets.js"),
        mode === "failure"
          ? 'exports.up = (pgm) => pgm.sql("INVALID SQL")'
          : 'exports.up = (pgm) => pgm.createTable("widgets", { id: "id", name: { type: "text", notNull: true } })',
      )
      const pkg = JSON.parse(
        fs.readFileSync(path.join(cwd, "package.json"), "utf8"),
      )
      const args = pkg.scripts["db:generate"].split(" ").slice(1)
      if (mode === "explicit") args.push("--pglite")
      if (mode === "external") args.push("--no-pglite")
      const proc = Bun.spawn([process.execPath, cli, ...args], {
        cwd,
        env: {
          ...process.env,
          POSTGRES_URI: unreachable,
          PG_URI: unreachable,
          DATABASE_URL: unreachable,
          DATABASE_URI: unreachable,
        },
        stdout: "pipe",
        stderr: "pipe",
        timeout: 15000,
      })
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])
      expect(proc.signalCode).toBeNull()
      if (mode === "external" || mode === "failure") {
        expect(code).not.toBe(0)
        expect(stdout + stderr).toMatch(
          mode === "external" ? /ECONNREFUSED/ : /syntax error/i,
        )
        expect(
          fs.existsSync(path.join(cwd, "src/db/zapatos/schema.d.ts")),
        ).toBe(false)
      } else {
        expect(code).toBe(0)
        expect(
          fs.readFileSync(path.join(cwd, "src/db/zapatos/schema.d.ts"), "utf8"),
        ).toContain('"widgets"')
        expect(
          fs.readFileSync(
            path.join(cwd, "src/db/structure/public/tables/widgets/table.sql"),
            "utf8",
          ),
        ).toContain("name")
      }
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  }, 20000)
}

test("programmatic generation restores connection settings after output failure", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-cleanup-"))
  try {
    fs.mkdirSync(path.join(cwd, "migrations"))
    fs.writeFileSync(
      path.join(cwd, "migrations/1700000000000_table.js"),
      'exports.up = (pgm) => pgm.createTable("foo", { id: "id" })',
    )
    fs.writeFileSync(path.join(cwd, "blocked"), "not a directory")
    const source = `
      import { generate } from ${JSON.stringify(generateModule)};
      const keys = ["POSTGRES_URI", "PG_URI", "DATABASE_URL", "DATABASE_URI"];
      const before = keys.map(key => process.env[key]);
      try {
        await generate({ schemas: ["public"], defaultDatabase: "postgres", migrationsDir: "./migrations", dbDir: "./blocked" });
        throw new Error("Expected generation to fail");
      } catch (error) {
        if (!String(error).match(/ENOTDIR|EEXIST/)) throw error;
      }
      if (keys.some((key, i) => process.env[key] !== before[i])) throw new Error("Environment was not restored");
    `
    const proc = Bun.spawn([process.execPath, "-e", source], {
      cwd,
      env: {
        ...process.env,
        POSTGRES_URI: unreachable,
        PG_URI: "",
        DATABASE_URL: unreachable,
      },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 15000,
    })
    const [, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    expect(proc.signalCode).toBeNull()
    expect(stderr).not.toContain("Environment was not restored")
    expect(code).toBe(0)
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true })
  }
}, 20000)
