import { beforeAll, test, expect } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { initPgstrap } from "../src/init"

const projectDir = path.resolve(import.meta.dir, "..")

beforeAll(async () => {
  const build = Bun.spawn([process.execPath, "run", "build"], {
    cwd: projectDir,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 15000,
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    build.exited,
    new Response(build.stdout).text(),
    new Response(build.stderr).text(),
  ])
  if (exitCode !== 0) throw new Error(`Build failed:\n${stdout}${stderr}`)
}, 20000)

test("scaffolded db:generate works without external Postgres", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-init-generate-"))

  try {
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      JSON.stringify({ name: "generate-test" }),
    )
    await initPgstrap({ cwd: tmp })

    const migrationsDir = path.join(tmp, "src", "db", "migrations")
    fs.mkdirSync(migrationsDir, { recursive: true })
    fs.writeFileSync(
      path.join(migrationsDir, "1700000000000_create_users.js"),
      `exports.up = (pgm) => {
  pgm.createTable("users", {
    id: "id",
    username: { type: "text", notNull: true },
  })
}
exports.down = (pgm) => pgm.dropTable("users")
`,
    )

    // Run the built CLI through the script created by init, without installing
    // another copy of pgstrap or contacting the package registry.
    const binDir = path.join(tmp, "node_modules", ".bin")
    const cliPath = path.join(projectDir, "dist", "cli.cjs")
    fs.mkdirSync(binDir, { recursive: true })
    if (process.platform === "win32") {
      fs.writeFileSync(
        path.join(binDir, "pgstrap.cmd"),
        `@"${process.execPath}" "${cliPath}" %*\r\n`,
      )
    } else {
      const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
      fs.writeFileSync(
        path.join(binDir, "pgstrap"),
        `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(cliPath)} "$@"\n`,
        { mode: 0o755 },
      )
    }

    const child = Bun.spawn([process.execPath, "run", "db:generate"], {
      cwd: tmp,
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
        DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:1/unavailable",
        PGHOST: "127.0.0.1",
        PGPORT: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 20000,
    })
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    if (exitCode !== 0)
      throw new Error(`db:generate failed:\n${stdout}${stderr}`)
    expect(exitCode).toBe(0)

    const dbDir = path.join(tmp, "src", "db")
    const types = fs.readFileSync(
      path.join(dbDir, "zapatos", "schema.d.ts"),
      "utf8",
    )
    const sql = fs.readFileSync(
      path.join(dbDir, "structure", "public", "tables", "users", "table.sql"),
      "utf8",
    )
    expect(types).toContain("users")
    expect(types).toContain("username: string")
    expect(sql).toContain("CREATE TABLE\n  public.users")
    expect(sql).toContain("username text NOT NULL")
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}, 25000)
