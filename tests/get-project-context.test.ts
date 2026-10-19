import { afterAll, beforeAll, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { spawnSync } from "node:child_process"

let testDir: string

beforeAll(async () => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-config-"))
  const build = await Bun.build({
    entrypoints: [
      path.resolve(import.meta.dir, "../src/get-project-context.ts"),
    ],
    target: "node",
    format: "esm",
  })
  if (!build.success) throw new Error("Could not build config loader")
  fs.writeFileSync(
    path.join(testDir, "context.mjs"),
    await build.outputs[0]!.text(),
  )
  fs.writeFileSync(
    path.join(testDir, "load.mjs"),
    'import { getProjectContext } from "./context.mjs"; console.log(JSON.stringify(await getProjectContext()))',
  )
})

afterAll(() => {
  fs.rmSync(testDir, { recursive: true, force: true })
})

for (const type of ["commonjs", "module"]) {
  for (const directory of [
    "plain",
    "project#hash",
    "project?query",
    "project%25literal",
  ]) {
    // Windows does not permit question marks in directory names.
    if (process.platform === "win32" && directory === "project?query") continue

    test(`getProjectContext loads ${type} config in ${directory}`, () => {
      const cwd = path.join(testDir, `${type}-${directory}`)
      fs.mkdirSync(cwd)
      fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ type }))
      const config = {
        defaultDatabase: "configured_database",
        schemas: ["custom"],
        dbDir: "./generated db",
      }
      const configExport =
        type === "module" ? "export default " : "module.exports = "
      fs.writeFileSync(
        path.join(cwd, "pgstrap.config.js"),
        `${configExport}${JSON.stringify(config)}`,
      )
      const result = spawnSync("node", [path.join(testDir, "load.mjs")], {
        cwd,
        encoding: "utf8",
        timeout: 10000,
      })
      expect(result.status, result.stderr).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual({ cwd, ...config })
    })
  }
}
