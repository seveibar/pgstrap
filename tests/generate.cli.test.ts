import { test, expect } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { initPgstrap } from "../src/init"

async function createProject() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-cli-"))
  fs.writeFileSync(
    path.join(cwd, "package.json"),
    JSON.stringify({ name: "pgstrap-cli-fixture" }),
  )
  await initPgstrap({ cwd })
  fs.writeFileSync(
    path.join(cwd, "pgstrap.config.js"),
    'module.exports = { defaultDatabase: "pgstrap_fixture", schemas: ["public"], dbDir: "db" }',
  )
  fs.mkdirSync(path.join(cwd, "db/migrations"), { recursive: true })
  fs.writeFileSync(
    path.join(cwd, "db/migrations/001_create_table.js"),
    'exports.up = (pgm) => pgm.createTable("cli_fixture", { id: "id" }); exports.down = (pgm) => pgm.dropTable("cli_fixture");',
  )

  // Run the generated package script through the real CLI, without a global install.
  const bin = path.join(cwd, "node_modules/.bin/pgstrap")
  fs.mkdirSync(path.dirname(bin), { recursive: true })
  fs.writeFileSync(
    bin,
    `#!${process.execPath}\nimport ${JSON.stringify(path.resolve(import.meta.dir, "../src/cli.ts"))}\n`,
    { mode: 0o755 },
  )
  return cwd
}

async function runGenerate(cwd: string, args: string[] = []) {
  const child = Bun.spawn([process.execPath, "run", "db:generate", ...args], {
    cwd,
    // An unreachable fixture URL proves no existing PostgreSQL is being used.
    env: {
      PATH: [path.dirname(process.execPath), process.env.PATH].join(
        path.delimiter,
      ),
      HOME: process.env.HOME,
      NODE_ENV: "test",
      DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:1/pgstrap_fixture",
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const timer = setTimeout(() => child.kill(), 15_000)
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    return { exitCode, stdout, stderr }
  } finally {
    clearTimeout(timer)
  }
}

test("generated db:generate works without an external PostgreSQL server", async () => {
  const cwd = await createProject()
  try {
    const result = await runGenerate(cwd)
    if (result.exitCode !== 0) {
      throw new Error(`Generation failed: ${result.stdout}\n${result.stderr}`)
    }
    const declarations = fs.readFileSync(
      path.join(cwd, "db/zapatos/schema.d.ts"),
      "utf8",
    )
    expect(declarations).toContain("cli_fixture")
    expect(
      fs.existsSync(
        path.join(cwd, "db/structure/public/tables/cli_fixture/table.sql"),
      ),
    ).toBe(true)
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true })
  }
}, 20_000)

test("--no-pglite explicitly selects the external PostgreSQL path", async () => {
  const cwd = await createProject()
  try {
    const result = await runGenerate(cwd, ["--no-pglite"])
    expect(result.exitCode).not.toBe(0)
    expect(result.stdout + result.stderr).toContain("ECONNREFUSED")
    expect(fs.existsSync(path.join(cwd, "db/zapatos/schema.d.ts"))).toBe(false)
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true })
  }
}, 20_000)
