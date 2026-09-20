import { beforeAll, test, expect } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const cli = path.join(root, "dist/cli.cjs")
const connectionKeys = [
  "POSTGRES_URI",
  "PG_URI",
  "DATABASE_URL",
  "DATABASE_URI",
]
const unavailableDatabase = "postgres://fixture:unused@127.0.0.1:1/no_database"

async function run(command: string[], cwd: string) {
  const child = Bun.spawn(command, {
    cwd,
    env: {
      ...process.env,
      NODE_ENV: "test",
      ...Object.fromEntries(
        connectionKeys.map((key) => [key, unavailableDatabase]),
      ),
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    child.kill()
  }, 15000)
  try {
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(timedOut).toBe(false)
    return { code, stdout, stderr }
  } finally {
    clearTimeout(timer)
  }
}

beforeAll(async () => {
  const result = await run([process.execPath, "run", "build"], root)
  expect({
    code: result.code,
    stderr: result.code ? result.stderr : "",
  }).toEqual({
    code: 0,
    stderr: "",
  })
  fs.chmodSync(cli, 0o755)
}, 20000)

for (const mode of [
  "default",
  "explicit",
  "external",
  "migration",
  "types",
  "dump",
]) {
  test(`initialized db:generate: ${mode}`, async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-cli-"))
    try {
      fs.writeFileSync(path.join(cwd, "package.json"), '{"name":"cli-fixture"}')
      const init = await run(["node", cli, "init"], cwd)
      expect(init.code).toBe(0)
      const bin = path.join(cwd, "node_modules/.bin")
      fs.mkdirSync(bin, { recursive: true })
      fs.symlinkSync(cli, path.join(bin, "pgstrap"))
      const migrations = path.join(cwd, "src/db/migrations")
      fs.mkdirSync(migrations, { recursive: true })
      fs.writeFileSync(
        path.join(migrations, "1700000000000_create.cjs"),
        mode === "migration"
          ? 'exports.up = () => { throw new Error("fixture migration failure") }'
          : 'exports.up = pgm => pgm.createTable("offline_widget", { id: "id", title: { type: "text", notNull: true } })',
      )
      if (mode === "types" || mode === "dump") {
        fs.writeFileSync(
          path.join(cwd, "src/db", mode === "types" ? "zapatos" : "structure"),
          "blocked",
        )
      }
      const flag =
        mode === "external"
          ? ["--no-pglite"]
          : mode === "explicit"
            ? ["--pglite"]
            : []
      const result = await run(
        [process.execPath, "run", "db:generate", ...flag],
        cwd,
      )
      if (mode === "default" || mode === "explicit") {
        expect({
          code: result.code,
          output: result.code ? result.stderr + result.stdout : "",
        }).toEqual({ code: 0, output: "" })
        const schema = fs.readFileSync(
          path.join(cwd, "src/db/zapatos/schema.d.ts"),
          "utf8",
        )
        expect(schema).toContain("offline_widget")
        expect(schema).toContain("title")
        const sql = fs.readFileSync(
          path.join(
            cwd,
            "src/db/structure/public/tables/offline_widget/table.sql",
          ),
          "utf8",
        )
        expect(sql).toContain("offline_widget")
        expect(sql).toContain("title")
      } else {
        expect(result.code).not.toBe(0)
        const output = result.stdout + result.stderr
        expect(output).toContain(
          mode === "external"
            ? "ECONNREFUSED"
            : mode === "migration"
              ? "fixture migration failure"
              : "EEXIST",
        )
      }
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  }, 20000)
}

test("generate API keeps external PostgreSQL as its default", async () => {
  const result = await run(
    [
      process.execPath,
      "-e",
      `const { generate } = require(${JSON.stringify(path.join(root, "dist/index.cjs"))}); await generate({ schemas: ["public"], defaultDatabase: "unused" })`,
    ],
    root,
  )
  expect(result.code).not.toBe(0)
  expect(result.stdout + result.stderr).toContain("ECONNREFUSED")
}, 20000)
