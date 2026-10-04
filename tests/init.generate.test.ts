import { test, expect } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import net from "net"
import { buildSync } from "esbuild"
import { initPgstrap } from "../src/init"

test("initialized db:generate needs no external PostgreSQL server", async () => {
  const tmpRoot = fs.realpathSync(os.tmpdir())
  const project = fs.mkdtempSync(path.join(tmpRoot, "pgstrap-init-generate-"))
  const repoRoot = path.resolve(import.meta.dir, "..")
  const cliDir = fs.mkdtempSync(path.join(repoRoot, ".pgstrap-cli-test-"))
  const cli = path.join(cliDir, "cli.cjs")
  buildSync({
    entryPoints: [path.join(repoRoot, "src/cli.ts")],
    outfile: cli,
    platform: "node",
    format: "cjs",
    bundle: true,
    packages: "external",
  })
  let externalConnections = 0
  const unavailablePostgres = net.createServer((socket) => {
    externalConnections += 1
    socket.destroy()
  })
  await new Promise<void>((resolve) =>
    unavailablePostgres.listen(0, "127.0.0.1", resolve),
  )
  const address = unavailablePostgres.address() as net.AddressInfo

  try {
    fs.writeFileSync(
      path.join(project, "package.json"),
      JSON.stringify({ name: "offline-fixture" }),
    )
    await initPgstrap({ cwd: project })

    const migrations = path.join(project, "src", "db", "migrations")
    fs.mkdirSync(migrations, { recursive: true })
    fs.writeFileSync(
      path.join(migrations, "001_create_widgets.js"),
      `
exports.up = (pgm) => pgm.createTable('widgets', {
  id: 'id',
  name: { type: 'text', notNull: true },
})
exports.down = (pgm) => pgm.dropTable('widgets')
`,
    )

    // Resolve the scaffolded pgstrap command to this checkout's real CLI,
    // without publishing/installing a package or replacing database code.
    const bin = path.join(project, "node_modules", ".bin")
    fs.mkdirSync(bin, { recursive: true })
    if (process.platform === "win32") {
      fs.writeFileSync(
        path.join(bin, "pgstrap.cmd"),
        `@"${process.execPath}" "${cli}" %*\r\n`,
      )
    } else {
      const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`
      const shim = path.join(bin, "pgstrap")
      fs.writeFileSync(
        shim,
        `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(cli)} "$@"\n`,
      )
      fs.chmodSync(shim, 0o755)
    }

    const child = Bun.spawn([process.execPath, "run", "db:generate"], {
      cwd: project,
      env: {
        ...process.env,
        NODE_ENV: "test",
        PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ""}`,
        DATABASE_URL: `postgres://fixture:fixture@127.0.0.1:${address.port}/unavailable`,
      },
      stdout: "pipe",
      stderr: "pipe",
    })
    const timeout = setTimeout(() => child.kill(), 25000)
    let exitCode: number
    let output: string
    try {
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      exitCode = code
      output = stdout + stderr
    } finally {
      clearTimeout(timeout)
    }

    expect({ exitCode, externalConnections, output }).toMatchObject({
      exitCode: 0,
      externalConnections: 0,
    })
    const types = fs.readFileSync(
      path.join(project, "src/db/zapatos/schema.d.ts"),
      "utf8",
    )
    const sql = fs.readFileSync(
      path.join(project, "src/db/structure/public/tables/widgets/table.sql"),
      "utf8",
    )
    expect(types).toContain("widgets")
    expect(types).toContain("name")
    expect(sql).toMatch(/CREATE TABLE[\s\S]*widgets/)
    expect(sql).toContain("name text NOT NULL")
  } finally {
    await new Promise<void>((resolve) =>
      unavailablePostgres.close(() => resolve()),
    )
    const resolved = path.resolve(project)
    if (
      path.dirname(resolved) !== tmpRoot ||
      !path.basename(resolved).startsWith("pgstrap-init-generate-")
    ) {
      throw new Error("Temporary fixture escaped its intended directory")
    }
    fs.rmSync(resolved, { recursive: true, force: true })
    if (
      path.dirname(path.resolve(cliDir)) !== repoRoot ||
      !path.basename(cliDir).startsWith(".pgstrap-cli-test-")
    ) {
      throw new Error("Temporary CLI escaped its intended directory")
    }
    fs.rmSync(cliDir, { recursive: true, force: true })
  }
}, 30000)
