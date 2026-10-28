import { beforeAll, test, expect } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { initPgstrap } from "../src/init"

const repoDir = path.resolve(import.meta.dir, "..")

beforeAll(async () => {
  const build = Bun.spawn([process.execPath, "run", "build"], {
    cwd: repoDir,
    stdout: "pipe",
    stderr: "pipe",
  })
  const output = Promise.all([
    new Response(build.stdout).text(),
    new Response(build.stderr).text(),
  ])
  const exitCode = await build.exited
  const [stdout, stderr] = await output
  if (exitCode !== 0) throw new Error(`Build failed: ${stdout}\n${stderr}`)
}, 30000)

for (const externalPostgres of [false, true]) {
  test(externalPostgres
    ? "--no-pglite still selects the external database"
    : "the initialized generate command works without external Postgres", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-cli-"))
    let child: ReturnType<typeof Bun.spawn> | undefined
    try {
      fs.writeFileSync(path.join(cwd, "package.json"), "{}")
      await initPgstrap({ cwd })
      const pkg = JSON.parse(
        fs.readFileSync(path.join(cwd, "package.json"), "utf8"),
      )
      expect(pkg.scripts["db:generate"]).toBe("pgstrap generate")
      const binDir = path.join(cwd, "node_modules/.bin")
      fs.mkdirSync(binDir, { recursive: true })
      fs.symlinkSync(
        path.join(repoDir, "dist/cli.cjs"),
        path.join(binDir, "pgstrap"),
      )
      const migrationsDir = path.join(cwd, "src/db/migrations")
      fs.mkdirSync(migrationsDir, { recursive: true })
      fs.writeFileSync(
        path.join(migrationsDir, "1700000000000_create_widgets.js"),
        `exports.up = (pgm) => pgm.createTable("widgets", {
        id: "id", name: { type: "text", notNull: true }
      })`,
      )

      child = Bun.spawn(
        [
          process.execPath,
          "run",
          "db:generate",
          ...(externalPostgres ? ["--no-pglite"] : []),
        ],
        {
          cwd,
          env: {
            ...process.env,
            DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/unavailable",
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      )
      const output = Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      const timer = setTimeout(() => child?.kill(), 15000)
      try {
        const exitCode = await child.exited
        const [stdout, stderr] = await output
        if (externalPostgres) {
          expect(exitCode).not.toBe(0)
          expect(stdout + stderr).toContain("ECONNREFUSED")
          expect(stdout + stderr).toContain("127.0.0.1:1")
          expect(
            fs.existsSync(path.join(cwd, "src/db/zapatos/schema.d.ts")),
          ).toBe(false)
          return
        }
        if (exitCode !== 0)
          throw new Error(
            `Generation failed (${exitCode}): ${stdout}\n${stderr}`,
          )
        expect(exitCode).toBe(0)
        expect(
          fs.readFileSync(path.join(cwd, "src/db/zapatos/schema.d.ts"), "utf8"),
        ).toContain("widgets")
        expect(
          fs.readFileSync(
            path.join(cwd, "src/db/structure/public/tables/widgets/table.sql"),
            "utf8",
          ),
        ).toContain("CREATE TABLE")
      } finally {
        clearTimeout(timer)
      }
    } finally {
      child?.kill()
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  }, 20000)
}
