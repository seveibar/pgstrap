import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { pathToFileURL } from "node:url"

test.each([
  ["named runner", "{ runner }"],
  ["default runner", "{ default: runner }"],
  ["nested default runner", "{ default: { default: runner } }"],
])("migrate supports node-pg-migrate's %s export", (_name, exports) => {
  const migrateUrl = pathToFileURL(
    path.resolve(import.meta.dir, "../src/migrate.ts"),
  ).href
  // Isolate module mocks so they cannot affect the real migration tests.
  const result = spawnSync(
    process.execPath,
    [
      "--eval",
      `import { mock } from "bun:test"
      import assert from "node:assert/strict"
      const client = {}
      let called = false
      const runner = async (options) => {
        assert.equal(options.dbClient, client)
        assert.equal(options.direction, "up")
        assert.equal(options.dir, "test-migrations")
        called = true
      }
      mock.module("node-pg-migrate", () => (${exports}))
      const { migrate } = await import(${JSON.stringify(migrateUrl)})
      await migrate({ client, cwd: ".", migrationsDir: "test-migrations" })
      assert.equal(called, true)`,
    ],
    {
      cwd: path.resolve(import.meta.dir, ".."),
      encoding: "utf8",
      timeout: 10000,
      env: { ...process.env, NODE_ENV: "test" },
    },
  )
  if (result.status !== 0) throw new Error(result.stdout + result.stderr)
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(0)
})
