import { test, expect } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { initPgstrap } from "../src/init"

const cli = path.resolve(import.meta.dir, "../src/cli.ts")

async function runGenerate(args: string[], brokenMigration = false) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-cli-"))
  try {
    fs.writeFileSync(path.join(tmp, "package.json"), '{"name":"test-project"}')
    await initPgstrap({ cwd: tmp })
    const migrations = path.join(tmp, "src/db/migrations")
    fs.mkdirSync(migrations, { recursive: true })
    fs.writeFileSync(
      path.join(migrations, "1700000000000_create_foo.js"),
      brokenMigration
        ? 'exports.up = () => { throw new Error("migration failed deliberately") }'
        : 'exports.up = (pgm) => pgm.createTable("foo", { id: "id", name: "text" })',
    )
    // Make the scaffolded script resolve the source CLI under this Bun runtime.
    const bin = path.join(tmp, "bin")
    fs.mkdirSync(bin)
    fs.writeFileSync(
      path.join(bin, "pgstrap"),
      `#!${process.execPath}\nimport ${JSON.stringify(cli)}\n`,
      { mode: 0o755 },
    )
    const child = Bun.spawn([process.execPath, "run", "db:generate", ...args], {
      cwd: tmp,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:1/unavailable",
      },
      stdout: "pipe",
      stderr: "pipe",
    })
    const timer = setTimeout(() => child.kill(), 15000)
    let exitCode: number
    let output: string
    try {
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      exitCode = code
      output = stdout + stderr
    } finally {
      clearTimeout(timer)
    }
    const schemaFile = path.join(tmp, "src/db/zapatos/schema.d.ts")
    const tableFile = path.join(
      tmp,
      "src/db/structure/public/tables/foo/table.sql",
    )
    return {
      exitCode,
      output,
      schema: fs.existsSync(schemaFile)
        ? fs.readFileSync(schemaFile, "utf8")
        : "",
      table: fs.existsSync(tableFile) ? fs.readFileSync(tableFile, "utf8") : "",
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

for (const args of [[], ["--pglite"]]) {
  test(`db:generate ${args.join(" ")} succeeds without Postgres and exits`, async () => {
    const result = await runGenerate(args)
    expect({
      exitCode: result.exitCode,
      output: result.exitCode ? result.output : "",
    }).toEqual({ exitCode: 0, output: "" })
    expect(result.schema).toContain("foo")
    expect(result.schema).toContain("name")
    expect(result.table).toContain("foo")
    expect(result.table).toContain("name")
  }, 20000)
}

test("--no-pglite uses the configured Postgres connection", async () => {
  const result = await runGenerate(["--no-pglite"])
  expect(result.exitCode).not.toBe(0)
  expect(result.output).toContain("ECONNREFUSED")
  expect(result.schema).toBe("")
}, 20000)

test("a failed migration exits with the original error", async () => {
  const result = await runGenerate([], true)
  expect(result.exitCode).not.toBe(0)
  expect(result.output).toContain("migration failed deliberately")
  expect(result.schema).toBe("")
}, 20000)
