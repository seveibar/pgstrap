import { expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { fileURLToPath } from "url"

const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url))
const unavailableDatabase =
  "postgres://pgstrap:pgstrap@127.0.0.1:1/unavailable_database"
// PGlite's first initialization is substantially slower on Windows.
const childTimeoutMs = process.platform === "win32" ? 120_000 : 30_000
const testTimeoutMs = childTimeoutMs + 15_000

const migration = `
exports.up = (pgm) => {
  pgm.createSchema('audit')
  pgm.createTable('fixture_accounts', {
    id: 'id',
    email: { type: 'text', notNull: true, unique: true },
  })
  pgm.createTable('fixture_projects', {
    id: 'id',
    owner_id: { type: 'integer', references: 'fixture_accounts', notNull: true },
    title: { type: 'text', notNull: true },
  })
  pgm.createTable({ schema: 'audit', name: 'fixture_events' }, {
    id: 'id',
    action: { type: 'text', notNull: true },
  })
}
`

async function withProject(
  migrationSource: string,
  check: (projectDir: string) => Promise<void>,
) {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-cli-"))
  try {
    fs.writeFileSync(
      path.join(projectDir, "package.json"),
      JSON.stringify({ name: "pgstrap-cli-fixture", private: true }),
    )
    fs.writeFileSync(
      path.join(projectDir, "pgstrap.config.js"),
      `module.exports = ${JSON.stringify({
        defaultDatabase: "unavailable_database",
        schemas: ["public", "audit"],
        dbDir: "./database",
      })}`,
    )
    const migrationsDir = path.join(projectDir, "database", "migrations")
    fs.mkdirSync(migrationsDir, { recursive: true })
    fs.writeFileSync(
      path.join(migrationsDir, "001_create_fixture.js"),
      migrationSource,
    )
    await check(projectDir)
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true })
  }
}

async function runGenerate(projectDir: string, args: string[] = []) {
  const child = Bun.spawn([process.execPath, cliPath, "generate", ...args], {
    cwd: projectDir,
    env: {
      ...process.env,
      NODE_ENV: "test",
      POSTGRES_URI: unavailableDatabase,
      PG_URI: unavailableDatabase,
      DATABASE_URL: unavailableDatabase,
      DATABASE_URI: unavailableDatabase,
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      child.kill()
      reject(
        new Error(`pgstrap generate did not exit within ${childTimeoutMs}ms`),
      )
    }, childTimeoutMs)
  })

  try {
    const [exitCode, stdout, stderr] = await Promise.race([
      Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]),
      deadline,
    ])
    return { exitCode, stdout, stderr }
  } finally {
    clearTimeout(timeout)
    if (child.exitCode === null) child.kill()
    await child.exited
  }
}

test(
  "generate CLI defaults to PGlite despite external database environment variables",
  async () => {
    await withProject(migration, async (projectDir) => {
      const result = await runGenerate(projectDir)
      if (result.exitCode !== 0) {
        throw new Error(
          `generate exited ${result.exitCode}:\n${result.stdout}\n${result.stderr}`,
        )
      }

      const databaseDir = path.join(projectDir, "database")
      const types = fs.readFileSync(
        path.join(databaseDir, "zapatos", "schema.d.ts"),
        "utf8",
      )
      for (const name of [
        "fixture_accounts",
        "fixture_projects",
        "fixture_events",
        "email",
        "owner_id",
        "action",
      ]) {
        expect(types).toContain(name)
      }
      expect(types).toContain("namespace audit")

      for (const [schema, table, column] of [
        ["public", "fixture_accounts", "email"],
        ["public", "fixture_projects", "owner_id"],
        ["audit", "fixture_events", "action"],
      ] as const) {
        const sql = fs
          .readFileSync(
            path.join(
              databaseDir,
              "structure",
              schema,
              "tables",
              table,
              "table.sql",
            ),
            "utf8",
          )
          .toLowerCase()
          .replace(/\s+/g, " ")
        expect(sql).toContain(`create table ${schema}.${table}`)
        expect(sql).toContain(column)
        expect(sql).toContain("not null")
      }
    })
  },
  testTimeoutMs,
)

test(
  "generate CLI exits with an error when a migration fails",
  async () => {
    await withProject(
      `exports.up = (pgm) => { pgm.sql('SELECT * FROM missing_pgstrap_fixture_table') }`,
      async (projectDir) => {
        const result = await runGenerate(projectDir)
        expect(result.exitCode).not.toBe(0)
        expect(result.stdout + result.stderr).toContain(
          "missing_pgstrap_fixture_table",
        )
        expect(
          fs.existsSync(
            path.join(projectDir, "database", "zapatos", "schema.d.ts"),
          ),
        ).toBe(false)
      },
    )
  },
  testTimeoutMs,
)

test(
  "generate CLI --no-pglite preserves the external PostgreSQL connection mode",
  async () => {
    await withProject(migration, async (projectDir) => {
      const result = await runGenerate(projectDir, ["--no-pglite"])
      expect(result.exitCode).not.toBe(0)
      expect(result.stdout + result.stderr).toMatch(
        /ECONNREFUSED|Connection refused/i,
      )
      expect(
        fs.existsSync(
          path.join(projectDir, "database", "zapatos", "schema.d.ts"),
        ),
      ).toBe(false)
    })
  },
  testTimeoutMs,
)
