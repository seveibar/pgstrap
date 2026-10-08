import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const cliPath = path.resolve(import.meta.dir, "../src/cli.ts")
const generateUrl = pathToFileURL(
  path.resolve(import.meta.dir, "../src/generate.ts"),
).href
const externalUrl = "postgres://unused:unused@127.0.0.1:1/not_used"

async function runFixture(command: string[], cwd: string) {
  const child = Bun.spawn(command, {
    cwd,
    // All URI aliases deliberately point at an unreachable external server.
    // PGlite must generate from migrations without using any of them.
    env: {
      ...process.env,
      POSTGRES_URI: externalUrl,
      POSTGRES_URL: externalUrl,
      PG_URI: externalUrl,
      DATABASE_URL: externalUrl,
      NODE_ENV: "test",
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
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    if (timedOut || exitCode !== 0) {
      throw new Error(
        `Fixture failed (timeout=${timedOut}, exit=${exitCode}):\n${stdout}\n${stderr}`,
      )
    }
    return stdout
  } finally {
    clearTimeout(timer)
  }
}

async function createFixture() {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "pgstrap-default-"))
  await fs.mkdir(path.join(cwd, "src/db/migrations"), { recursive: true })
  await fs.writeFile(
    path.join(cwd, "pgstrap.config.js"),
    'module.exports = { defaultDatabase: "not_used", schemas: ["public"] }',
  )
  await fs.writeFile(
    path.join(cwd, "src/db/migrations/001_create_table.js"),
    "exports.up = (pgm) => pgm.createTable('offline_record', { id: 'id', name: { type: 'text', notNull: true } })",
  )
  return cwd
}

for (const mode of ["cli", "api"] as const) {
  test(`${mode} defaults to PGlite and exits after generating real schema files`, async () => {
    const cwd = await createFixture()
    try {
      if (mode === "cli") {
        await fs.writeFile(
          path.join(cwd, "package.json"),
          JSON.stringify({
            scripts: {
              "db:generate": `${JSON.stringify(process.execPath)} ${JSON.stringify(cliPath)} generate`,
            },
          }),
        )
        // Exercise the issue's user-facing command, without --pglite.
        await runFixture([process.execPath, "run", "db:generate"], cwd)
      } else {
        await fs.writeFile(
          path.join(cwd, "generate.ts"),
          `import { generate } from ${JSON.stringify(generateUrl)}
import assert from "node:assert/strict"
const keys = ["POSTGRES_URI", "POSTGRES_URL", "PG_URI", "DATABASE_URL"] as const
const before = keys.map(key => process.env[key])
await generate({ schemas: ["public"], defaultDatabase: "not_used", dbDir: "./src/db" })
keys.forEach((key, index) => assert.equal(process.env[key], before[index]))
`,
        )
        await runFixture([process.execPath, "generate.ts"], cwd)
      }
      const schema = await fs.readFile(
        path.join(cwd, "src/db/zapatos/schema.d.ts"),
        "utf8",
      )
      expect(schema).toContain("offline_record")
      expect(schema).toContain("name")
      expect(
        await fs.readFile(
          path.join(
            cwd,
            "src/db/structure/public/tables/offline_record/table.sql",
          ),
          "utf8",
        ),
      ).toContain("offline_record")
    } finally {
      await fs.rm(cwd, { recursive: true, force: true })
    }
  }, 20000)
}

test("failed embedded generation restores every connection URI and releases the listener", async () => {
  const cwd = await createFixture()
  try {
    // Force an output failure after migrations and listener startup.
    await fs.writeFile(path.join(cwd, "src/db/zapatos"), "not a directory")
    await fs.writeFile(
      path.join(cwd, "failure.ts"),
      `import { generate } from ${JSON.stringify(generateUrl)}
import assert from "node:assert/strict"
const keys = ["POSTGRES_URI", "POSTGRES_URL", "PG_URI", "DATABASE_URL"] as const
const before = keys.map(key => process.env[key])
await assert.rejects(
  generate({ schemas: ["public"], defaultDatabase: "not_used", dbDir: "./src/db", pglite: true }),
  /EEXIST|ENOTDIR/,
)
keys.forEach((key, index) => assert.equal(process.env[key], before[index]))
console.log("expected-generation-failure")
`,
    )
    expect(await runFixture([process.execPath, "failure.ts"], cwd)).toContain(
      "expected-generation-failure",
    )
  } finally {
    await fs.rm(cwd, { recursive: true, force: true })
  }
}, 20000)


test("serializes concurrent embedded generation without mixing schemas or leaking PG URLs", async () => {
  const first = await createFixture()
  const second = await createFixture()
  const keys = ["POSTGRES_URI", "POSTGRES_URL", "PG_URI", "DATABASE_URL"] as const
  const previous = keys.map((key) => process.env[key])
  const firstTable = "first_offline_record"
  const secondTable = "second_offline_record"

  try {
    await fs.writeFile(
      path.join(first, "src/db/migrations/001_create_table.js"),
      `exports.up = (pgm) => pgm.createTable('${firstTable}', { id: 'id' })`,
    )
    await fs.writeFile(
      path.join(second, "src/db/migrations/001_create_table.js"),
      `exports.up = (pgm) => pgm.createTable('${secondTable}', { id: 'id' })`,
    )
    for (const key of keys) process.env[key] = externalUrl
    const { generate } = await import(generateUrl)

    const options = (cwd: string) => ({
      schemas: ["public"],
      defaultDatabase: "not_used",
      dbDir: path.join(cwd, "src/db"),
      migrationsDir: path.join(cwd, "src/db/migrations"),
    })
    await Promise.all([
      generate(options(first)),
      generate(options(second)),
    ])

    const firstSchema = await fs.readFile(
      path.join(first, "src/db/zapatos/schema.d.ts"), "utf8",
    )
    const secondSchema = await fs.readFile(
      path.join(second, "src/db/zapatos/schema.d.ts"), "utf8",
    )
    expect(firstSchema).toContain(firstTable)
    expect(firstSchema).not.toContain(secondTable)
    expect(secondSchema).toContain(secondTable)
    expect(secondSchema).not.toContain(firstTable)
    for (const key of keys) expect(process.env[key]).toBe(externalUrl)
  } finally {
    keys.forEach((key, index) => {
      const value = previous[index]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    })
    await Promise.all([
      fs.rm(first, { recursive: true, force: true }),
      fs.rm(second, { recursive: true, force: true }),
    ])
  }
}, 30000)
