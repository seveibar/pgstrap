import { afterEach, beforeEach, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createMigration } from "../src/migrate"

// Windows still uses its existing npx.cmd shell invocation.
const posixTest = process.platform === "win32" ? test.skip : test

let root: string
let previousPath: string | undefined
let previousOutput: string | undefined
let previousExit: string | undefined

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap create-"))
  const bin = path.join(root, "bin")
  fs.mkdirSync(bin)
  // Record the real subprocess boundary without invoking a database tool.
  const recorder = path.join(root, "record.cjs")
  fs.writeFileSync(
    recorder,
    'require("node:fs").writeFileSync(process.env.PGSTRAP_TEST_OUTPUT, JSON.stringify({args: process.argv.slice(2), cwd: process.cwd()})); process.exit(Number(process.env.PGSTRAP_TEST_EXIT ?? 0))',
  )
  fs.writeFileSync(
    path.join(bin, process.platform === "win32" ? "npx.cmd" : "npx"),
    process.platform === "win32"
      ? `@"${process.execPath}" "${recorder}" %*\r\n`
      : `#!/bin/sh\nexec '${process.execPath}' '${recorder}' "$@"\n`,
    { mode: 0o755 },
  )
  previousPath = process.env.PATH
  previousOutput = process.env.PGSTRAP_TEST_OUTPUT
  previousExit = process.env.PGSTRAP_TEST_EXIT
  delete process.env.PGSTRAP_TEST_EXIT
  process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ""}`
  process.env.PGSTRAP_TEST_OUTPUT = path.join(root, "invocation.json")
})

afterEach(() => {
  if (previousPath === undefined) delete process.env.PATH
  else process.env.PATH = previousPath
  if (previousOutput === undefined) delete process.env.PGSTRAP_TEST_OUTPUT
  else process.env.PGSTRAP_TEST_OUTPUT = previousOutput
  if (previousExit === undefined) delete process.env.PGSTRAP_TEST_EXIT
  else process.env.PGSTRAP_TEST_EXIT = previousExit
  fs.rmSync(root, { recursive: true, force: true })
})

const invocation = () =>
  JSON.parse(fs.readFileSync(path.join(root, "invocation.json"), "utf8"))

test("createMigration preserves the default migration directory", async () => {
  await createMigration("add-users", {
    cwd: process.cwd(),
    defaultDatabase: "unused",
    schemas: ["public"],
  })
  expect(invocation().args).toEqual([
    "node-pg-migrate",
    "--migration-file-language",
    "ts",
    "-m",
    "src/db/migrations",
    "create",
    "add-users",
  ])
})

test("createMigration runs from the supplied project directory", async () => {
  await createMigration("add-users", {
    cwd: root,
    defaultDatabase: "unused",
    schemas: ["public"],
  })
  expect(invocation().cwd).toBe(root)
})

test("createMigration resolves a custom relative directory from the project", async () => {
  await createMigration("add-users", {
    cwd: root,
    dbDir: "custom/db",
    defaultDatabase: "unused",
    schemas: ["public"],
  })
  const result = invocation()
  expect(path.resolve(result.cwd, result.args[4])).toBe(
    path.join(root, "custom", "db", "migrations"),
  )
})

test("createMigration propagates a child process failure", async () => {
  process.env.PGSTRAP_TEST_EXIT = "7"
  await expect(
    createMigration("add-users", {
      cwd: root,
      defaultDatabase: "unused",
      schemas: ["public"],
    }),
  ).rejects.toThrow()
})

posixTest(
  "createMigration preserves spaces in a relative migration directory",
  async () => {
    await createMigration("add-users", {
      cwd: root,
      dbDir: "database files",
      defaultDatabase: "unused",
      schemas: ["public"],
    })
    expect(invocation().args).toEqual([
      "node-pg-migrate",
      "--migration-file-language",
      "ts",
      "-m",
      "database files/migrations",
      "create",
      "add-users",
    ])
  },
)

posixTest(
  "createMigration preserves spaces in an absolute migration directory",
  async () => {
    const dbDir = path.join(root, "database files")
    await createMigration("add-users", {
      cwd: root,
      dbDir,
      defaultDatabase: "unused",
      schemas: ["public"],
    })
    expect(invocation().args[4]).toBe(`${dbDir}/migrations`)
  },
)

posixTest.each(["add users", 'add-"quoted"-users', "add-'quoted'-users"])(
  "createMigration preserves the literal migration name %s",
  async (name) => {
    await createMigration(name, {
      cwd: root,
      defaultDatabase: "unused",
      schemas: ["public"],
    })
    expect(invocation().args.slice(5)).toEqual(["create", name])
  },
)

posixTest(
  "createMigration does not interpret shell syntax in a migration name",
  async () => {
    const name = "add-users; printf injected > unexpected-file"
    await createMigration(name, {
      cwd: root,
      defaultDatabase: "unused",
      schemas: ["public"],
    })
    expect(fs.existsSync(path.join(root, "unexpected-file"))).toBe(false)
    expect(invocation().args.slice(5)).toEqual(["create", name])
  },
)

posixTest(
  "createMigration preserves quotes and variable syntax in a directory",
  async () => {
    await createMigration("add-users", {
      cwd: root,
      dbDir: "database 'files' $PGSTRAP_TEST_EXIT",
      defaultDatabase: "unused",
      schemas: ["public"],
    })
    expect(invocation().args[4]).toBe(
      "database 'files' $PGSTRAP_TEST_EXIT/migrations",
    )
  },
)

test("createMigration preserves an ordinary absolute migration directory", async () => {
  const dbDir = path.resolve(path.parse(root).root, "pgstrap", "db")
  await createMigration("add-users", {
    cwd: root,
    dbDir,
    defaultDatabase: "unused",
    schemas: ["public"],
  })
  expect(invocation().args[4]).toBe(`${dbDir}/migrations`)
})

test("createMigration rejects a nonexistent project directory", async () => {
  await expect(
    createMigration("add-users", {
      cwd: path.join(root, "missing"),
      defaultDatabase: "unused",
      schemas: ["public"],
    }),
  ).rejects.toThrow()
  expect(fs.existsSync(path.join(root, "invocation.json"))).toBe(false)
})

test("createMigration rejects a migration directory containing a null byte", async () => {
  await expect(
    createMigration("add-users", {
      cwd: root,
      dbDir: "invalid\u0000directory",
      defaultDatabase: "unused",
      schemas: ["public"],
    }),
  ).rejects.toThrow()
  expect(fs.existsSync(path.join(root, "invocation.json"))).toBe(false)
})

test("createMigration preserves the child process exit status", async () => {
  process.env.PGSTRAP_TEST_EXIT = "7"
  await expect(
    createMigration("add-users", {
      cwd: root,
      defaultDatabase: "unused",
      schemas: ["public"],
    }),
  ).rejects.toMatchObject({ status: 7 })
})
