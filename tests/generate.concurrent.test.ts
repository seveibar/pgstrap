import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { expect, test } from "bun:test"

test("PGlite connection exports remain isolated across overlapping calls", () => {
  const fixture = fileURLToPath(
    new URL("./generate.concurrent.fixture.ts", import.meta.url),
  )
  const result = spawnSync(process.execPath, ["test", fixture], {
    encoding: "utf8",
  })

  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
})
