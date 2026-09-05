import { afterEach, beforeAll, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const root = path.resolve(import.meta.dir, "..")
const cli = path.join(root, "dist", "cli.cjs")
const apiUrl = pathToFileURL(path.join(root, "dist", "index.cjs")).href
const fixtures: string[] = []
const refusedUri = "postgres://unused:unused@127.0.0.1:1/unused"

beforeAll(() => {
  const build = spawnSync(process.execPath, ["run", "build"], {
    cwd: root,
    encoding: "utf8",
    timeout: 30000,
  })
  expect(build.error).toBeUndefined()
  expect(build.status, build.stdout + build.stderr).toBe(0)
}, 35000)

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    if (
      path.dirname(fixture) !== path.resolve(os.tmpdir()) ||
      !path.basename(fixture).startsWith("pgstrap cli ")
    ) {
      throw new Error("Unexpected fixture cleanup path")
    }
    fs.rmSync(fixture, { recursive: true, force: true })
  }
})

function createFixture() {
  // Spaces and a URL fragment character exercise the packaged Node CLI on
  // Windows as well as POSIX; source execution under Bun accepts different paths.
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap cli #"))
  fixtures.push(cwd)
  fs.writeFileSync(path.join(cwd, "package.json"), '{"private":true}')
  fs.writeFileSync(
    path.join(cwd, "pgstrap.config.js"),
    'module.exports = { defaultDatabase: "postgres", schemas: ["public"] }',
  )
  const migrations = path.join(cwd, "src", "db", "migrations")
  fs.mkdirSync(migrations, { recursive: true })
  fs.writeFileSync(
    path.join(migrations, "1740000000000_create_widget.js"),
    `exports.up = (pgm) => pgm.createTable("widgets", { id: "id", name: { type: "text", notNull: true } });
exports.down = (pgm) => pgm.dropTable("widgets");`,
  )
  return cwd
}

function runNode(cwd: string, args: string[]) {
  return spawnSync("node", args, {
    cwd,
    env: {
      ...process.env,
      NODE_ENV: "test",
      POSTGRES_URI: refusedUri,
      PG_URI: refusedUri,
      DATABASE_URL: refusedUri,
      DATABASE_URI: refusedUri,
    },
    encoding: "utf8",
    timeout: 15000,
  })
}

test("packaged CLI generates types and SQL without Postgres despite URI aliases", () => {
  const cwd = createFixture()
  const result = runNode(cwd, [cli, "generate"])
  expect(result.error).toBeUndefined()
  expect(result.status, result.stdout + result.stderr).toBe(0)
  const dbDir = path.join(cwd, "src", "db")
  const types = fs.readFileSync(
    path.join(dbDir, "zapatos", "schema.d.ts"),
    "utf8",
  )
  const sql = fs.readFileSync(
    path.join(dbDir, "structure", "public", "tables", "widgets", "table.sql"),
    "utf8",
  )
  expect(types).toContain("widgets")
  expect(types).toContain("name: string")
  expect(sql).toMatch(/CREATE TABLE\s+public\.widgets/i)
  expect(sql).toMatch(/name\s+text\s+NOT NULL/i)
}, 20000)

test("explicit --no-pglite keeps using the configured Postgres connection", () => {
  const cwd = createFixture()
  const result = runNode(cwd, [cli, "generate", "--no-pglite"])
  expect(result.error).toBeUndefined()
  expect(result.status).not.toBe(0)
  expect(result.stdout + result.stderr).toContain("ECONNREFUSED")
  expect(
    fs.existsSync(path.join(cwd, "src", "db", "zapatos", "schema.d.ts")),
  ).toBe(false)
}, 20000)

test("a dump failure restores the environment and allows another generation to exit", () => {
  const cwd = createFixture()
  const script = `
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { generate } from ${JSON.stringify(apiUrl)};
const before = Object.fromEntries(["POSTGRES_URI", "PG_URI", "DATABASE_URL", "DATABASE_URI"].map(key => [key, process.env[key]]));
const migrationsDir = path.resolve("src/db/migrations");
const badDir = path.resolve("bad-output");
fs.mkdirSync(badDir);
fs.writeFileSync(path.join(badDir, "structure"), "block the SQL dump directory");
await assert.rejects(generate({ schemas: ["public"], defaultDatabase: "postgres", dbDir: badDir, migrationsDir }), error => ["EEXIST", "ENOTDIR"].includes(error.code));
for (const [key, value] of Object.entries(before)) assert.equal(process.env[key], value);
await generate({ schemas: ["public"], defaultDatabase: "postgres", dbDir: path.resolve("good-output"), migrationsDir });
for (const [key, value] of Object.entries(before)) assert.equal(process.env[key], value);
assert.ok(fs.readFileSync("good-output/structure/public/tables/widgets/table.sql", "utf8").includes("public.widgets"));
console.log("environment restored and recovery succeeded");
`
  const result = runNode(cwd, ["--input-type=module", "-e", script])
  expect(result.error).toBeUndefined()
  expect(result.status, result.stdout + result.stderr).toBe(0)
  expect(result.stdout).toContain("environment restored and recovery succeeded")
}, 20000)

test("concurrent generations keep schemas separate and restore URI aliases", () => {
  const cwd = createFixture()
  const script = `
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { generate } from ${JSON.stringify(apiUrl)};
const originalUri = process.env.POSTGRES_URI;
const secondMigrations = path.resolve("second-migrations");
fs.mkdirSync(secondMigrations);
fs.writeFileSync(path.join(secondMigrations, "1740000000001_create_gadget.js"), 'exports.up = pgm => pgm.createTable("gadgets", { id: "id" });');
await Promise.all([
  generate({ schemas: ["public"], defaultDatabase: "postgres", dbDir: path.resolve("first-output"), migrationsDir: path.resolve("src/db/migrations") }),
  generate({ schemas: ["public"], defaultDatabase: "postgres", dbDir: path.resolve("second-output"), migrationsDir: secondMigrations })
]);
assert.equal(process.env.POSTGRES_URI, originalUri);
for (const [dir, expected, absent] of [["first-output", "widgets", "gadgets"], ["second-output", "gadgets", "widgets"]]) {
  assert.ok(fs.readFileSync(path.join(dir, "zapatos/schema.d.ts"), "utf8").includes(expected));
  assert.ok(fs.existsSync(path.join(dir, "structure/public/tables", expected, "table.sql")));
  assert.ok(!fs.existsSync(path.join(dir, "structure/public/tables", absent)));
}
console.log("concurrent schemas isolated");
`
  const result = runNode(cwd, ["--input-type=module", "-e", script])
  expect(result.error).toBeUndefined()
  expect(result.status, result.stdout + result.stderr).toBe(0)
  expect(result.stdout).toContain("concurrent schemas isolated")
}, 20000)
