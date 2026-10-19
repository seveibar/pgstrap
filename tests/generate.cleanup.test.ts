import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { expect, test } from "bun:test"

test("PGlite resources are released after generation and migration errors", () => {
  const fixture = fileURLToPath(
    new URL("./generate.cleanup.fixture.ts", import.meta.url),
  )
  const result = spawnSync(process.execPath, ["test", fixture], {
    encoding: "utf8",
    timeout: 30000,
  })

  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
}, 30000)
