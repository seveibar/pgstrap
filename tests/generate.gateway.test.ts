import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { expect, test } from "bun:test"

test("PGlite gateway preserves query failures through the wire protocol", () => {
  const fixture = fileURLToPath(
    new URL("./generate.gateway.fixture.ts", import.meta.url),
  )
  const result = spawnSync(process.execPath, ["test", fixture], {
    encoding: "utf8",
    timeout: 30000,
  })

  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
}, 30000)
