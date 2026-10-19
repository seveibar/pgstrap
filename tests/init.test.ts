import { beforeEach, afterEach, test, expect } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { spawnSync } from "node:child_process"
import { initPgstrap } from "../src/init"

let testDir: string

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-test-"))
  fs.writeFileSync(
    path.join(testDir, "package.json"),
    JSON.stringify({ name: "some-package" }),
  )
})

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true })
})

test("initPgstrap writes scripts to package.json", async () => {
  await initPgstrap({ cwd: testDir })
  const pkg = JSON.parse(
    fs.readFileSync(path.join(testDir, "package.json"), "utf8"),
  )
  expect(pkg.scripts["db:migrate"]).toBe("pgstrap migrate")
  expect(pkg.scripts["db:reset"]).toBe("pgstrap reset")
  expect(pkg.scripts["db:generate"]).toBe("pgstrap generate --pglite")
  expect(pkg.scripts["db:create-migration"]).toBe("pgstrap create-migration")
})

for (const type of [undefined, "commonjs", "module"]) {
  test(`initPgstrap creates a Node-loadable config for ${type ?? "default"} projects`, async () => {
    fs.writeFileSync(
      path.join(testDir, "package.json"),
      JSON.stringify({ name: "some-package", type }),
    )

    await initPgstrap({ cwd: testDir })

    const loaderPath = path.join(testDir, "load-config.mjs")
    fs.writeFileSync(
      loaderPath,
      'import config from "./pgstrap.config.js"; console.log(JSON.stringify(config))',
    )
    const result = spawnSync("node", [loaderPath], {
      encoding: "utf8",
      timeout: 10000,
    })
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      defaultDatabase: "my_service_name",
      schemas: ["public"],
    })
  })
}

test("initPgstrap preserves an existing ES module config", async () => {
  fs.writeFileSync(
    path.join(testDir, "package.json"),
    JSON.stringify({ name: "some-package", type: "module" }),
  )
  const configPath = path.join(testDir, "pgstrap.config.js")
  const existing =
    'export default { defaultDatabase: "existing", schemas: ["custom"] }\n'
  fs.writeFileSync(configPath, existing)

  await initPgstrap({ cwd: testDir })

  expect(fs.readFileSync(configPath, "utf8")).toBe(existing)
})
