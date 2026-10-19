import { EventEmitter } from "node:events"
import { test, expect, mock } from "bun:test"
import { getConnectionStringFromEnv } from "pg-connection-from-env"

let generateImpl: (options: any) => Promise<void> = async () => {}
let dumpImpl: (options: any) => Promise<void> = async () => {}
let nextPort = 24000
let closedServers = 0
const boundAddresses: string[] = []
const children: Array<{
  env: NodeJS.ProcessEnv
  child: EventEmitter
  exit: (code: number, signal?: string | null) => void
}> = []

mock.module("zapatos/generate", () => ({
  generate: (options: any) => generateImpl(options),
}))
mock.module("pg-schema-dump", () => ({
  dumpTree: (options: any) => dumpImpl(options),
}))
mock.module("../src/migrate", () => ({ migrate: async () => {} }))
mock.module("@electric-sql/pglite", () => ({
  PGlite: class {
    async close() {}
  },
}))
mock.module("pg-gateway/node", () => ({ fromNodeSocket: async () => {} }))
mock.module("node:net", () => ({
  createServer: () => {
    const port = ++nextPort
    return Object.assign(new EventEmitter(), {
      listen: (_port: number, host: string, callback: () => void) => {
        boundAddresses.push(host)
        callback()
      },
      address: () => ({ port }),
      close: (callback: () => void) => {
        closedServers++
        callback()
      },
    })
  },
}))
mock.module("node:child_process", () => ({
  spawn: (
    _executable: string,
    _args: string[],
    options: { env: NodeJS.ProcessEnv },
  ) => {
    const child = new EventEmitter()
    children.push({
      env: options.env,
      child,
      exit: (code, signal = null) => child.emit("exit", code, signal),
    })
    return child
  },
}))

const { generate } = await import("../src/generate")
const keys = ["POSTGRES_URI", "PG_URI", "DATABASE_URL", "DATABASE_URI"] as const
const externalUri = "postgres://user:pass@127.0.0.1:1/external"
const options = (dbDir: string, pglite = true) => ({
  schemas: ["public"],
  defaultDatabase: "postgres",
  dbDir,
  pglite,
})
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
async function waitForChildCount(count: number) {
  while (children.length < count) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

async function isolated(run: () => Promise<void>) {
  const previous = Object.fromEntries(
    keys.map((key) => [key, process.env[key]]),
  )
  process.env.POSTGRES_URI = externalUri
  delete process.env.PG_URI
  delete process.env.DATABASE_URL
  process.env.DATABASE_URI = "postgres://lower:priority@127.0.0.1:2/other"
  children.length = 0
  boundAddresses.length = 0
  try {
    await run()
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
    generateImpl = async () => {}
    dumpImpl = async () => {}
  }
}

test("external generate keeps its URI while a PGlite call is suspended", async () => {
  await isolated(async () => {
    const enteredLocal = deferred()
    const releaseLocal = deferred()
    let externalTypesUri = ""
    let externalStructureUri = ""
    let localTypesUri = ""
    const expectedExternalUri = getConnectionStringFromEnv()
    generateImpl = async (opts) => {
      if (opts.outDir === "local") {
        localTypesUri = opts.db.connectionString
        enteredLocal.resolve()
        await releaseLocal.promise
      } else {
        externalTypesUri = opts.db.connectionString
      }
    }
    dumpImpl = async () => {
      externalStructureUri = getConnectionStringFromEnv()
    }

    const local = generate(options("local"))
    await enteredLocal.promise
    await generate(options("external", false))
    expect(externalTypesUri).toBe(expectedExternalUri)
    expect(externalStructureUri).toBe(expectedExternalUri)
    expect(process.env.POSTGRES_URI).toBe(externalUri)
    releaseLocal.resolve()
    await waitForChildCount(1)
    expect(children).toHaveLength(1)
    expect(boundAddresses).toEqual(["127.0.0.1"])
    expect(new URL(localTypesUri).password).toMatch(/^[a-f0-9]{48}$/)
    expect(children[0].env.POSTGRES_URI).toBe(localTypesUri)
    expect(children[0].env.PG_URI).toBe(localTypesUri)
    expect(children[0].env.DATABASE_URL).toBe(localTypesUri)
    children[0].exit(0)
    await local
  })
})

test("overlapping PGlite calls give each structure dump its own isolated URI", async () => {
  await isolated(async () => {
    const enteredA = deferred()
    const enteredB = deferred()
    const releaseA = deferred()
    const releaseB = deferred()
    const ownUris: Record<string, string> = {}
    generateImpl = async (opts) => {
      ownUris[opts.outDir] = opts.db.connectionString
      if (opts.outDir === "a") {
        enteredA.resolve()
        await releaseA.promise
      } else {
        enteredB.resolve()
        await releaseB.promise
      }
    }

    const a = generate(options("a"))
    const b = generate(options("b"))
    await Promise.all([enteredA.promise, enteredB.promise])
    releaseA.resolve()
    releaseB.resolve()
    await waitForChildCount(2)

    expect(children).toHaveLength(2)
    expect(boundAddresses).toEqual(["127.0.0.1", "127.0.0.1"])
    expect(new URL(ownUris.a).password).toMatch(/^[a-f0-9]{48}$/)
    expect(new URL(ownUris.b).password).toMatch(/^[a-f0-9]{48}$/)
    expect(new URL(ownUris.a).password).not.toBe(new URL(ownUris.b).password)
    expect(children[0].env.POSTGRES_URI).toBe(ownUris.a)
    expect(children[0].env.PG_URI).toBe(ownUris.a)
    expect(children[0].env.DATABASE_URL).toBe(ownUris.a)
    expect(children[1].env.POSTGRES_URI).toBe(ownUris.b)
    expect(children[1].env.PG_URI).toBe(ownUris.b)
    expect(children[1].env.DATABASE_URL).toBe(ownUris.b)
    expect(process.env.POSTGRES_URI).toBe(externalUri)
    children.forEach((child) => child.exit(0))
    await Promise.all([a, b])
  })
})

test("PGlite child export failures do not mutate the caller environment", async () => {
  await isolated(async () => {
    const initial = Object.fromEntries(
      keys.map((key) => [key, process.env[key]]),
    )
    generateImpl = async () => {}
    const run = generate(options("failure"))
    while (children.length === 0)
      await new Promise((resolve) => setTimeout(resolve, 0))
    children[0].exit(1)
    await expect(run).rejects.toThrow("pg-schema-dump exited with 1")
    expect(boundAddresses).toEqual(["127.0.0.1"])
    expect(
      Object.fromEntries(keys.map((key) => [key, process.env[key]])),
    ).toEqual(initial)
    expect(closedServers).toBeGreaterThan(0)
  })
})
