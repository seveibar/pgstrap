import { expect, mock, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import * as net from "node:net"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const nativeNet = { ...net }
const databases: PGlite[] = []
const servers: net.Server[] = []
const sockets: net.Socket[] = []
let closeFailure: Error | undefined

class TrackedPGlite extends PGlite {
  constructor() {
    super()
    databases.push(this)
  }

  override async close() {
    if (closeFailure) throw closeFailure
    await super.close()
  }
}

mock.module("@electric-sql/pglite", () => ({ PGlite: TrackedPGlite }))
mock.module("node:net", () => ({
  ...nativeNet,
  createServer: (listener: (socket: net.Socket) => void) => {
    const server = nativeNet.createServer(listener)
    servers.push(server)
    server.on("connection", (socket) => sockets.push(socket))
    server.once("listening", () => {
      const address = server.address() as net.AddressInfo
      const idleClient = nativeNet.createConnection({
        host: "127.0.0.1",
        port: address.port,
      })
      idleClient.on("error", () => {})
      sockets.push(idleClient)
    })
    return server
  },
}))

const { generate } = await import("../src/generate")

async function isolated(
  migration: string,
  run: (options: Parameters<typeof generate>[0]) => Promise<void>,
) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-cleanup-"))
  const migrationsDir = path.join(tmp, "migrations")
  fs.mkdirSync(migrationsDir)
  fs.writeFileSync(path.join(migrationsDir, "001_probe.js"), migration)
  databases.length = 0
  servers.length = 0
  sockets.length = 0
  try {
    await run({
      schemas: ["public"],
      defaultDatabase: "postgres",
      dbDir: path.join(tmp, "db"),
      migrationsDir,
      pglite: true,
    })
  } finally {
    closeFailure = undefined
    for (const socket of sockets) socket.destroy()
    for (const server of servers) {
      if (server.listening) {
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
    }
    for (const database of databases) {
      if (!database.closed) await database.close()
    }
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

test("generation closes its PGlite database and idle gateway connections", async () => {
  await isolated(
    "exports.up = (pgm) => pgm.createTable('probe', { id: 'id' })",
    async (options) => {
      await generate(options)
      const remainingConnections = await new Promise<number>(
        (resolve, reject) =>
          servers[0].getConnections((error, count) =>
            error ? reject(error) : resolve(count),
          ),
      )
      expect({
        databaseClosed: databases[0].closed,
        gatewayListening: servers[0].listening,
        remainingConnections,
      }).toEqual({
        databaseClosed: true,
        gatewayListening: false,
        remainingConnections: 0,
      })
    },
  )
})

test("migration failures close the temporary PGlite database", async () => {
  await isolated(
    "exports.up = () => { throw new Error('expected migration failure') }",
    async (options) => {
      await expect(generate(options)).rejects.toThrow(
        "expected migration failure",
      )
      expect(databases[0].closed).toBe(true)
      expect(servers.every((server) => !server.listening)).toBe(true)
    },
  )
})

test("generation and cleanup failures both remain available to the caller", async () => {
  await isolated(
    "exports.up = () => { throw new Error('expected migration failure') }",
    async (options) => {
      closeFailure = new Error("expected cleanup failure")
      let failure: unknown
      try {
        await generate(options)
      } catch (error) {
        failure = error
      }
      expect(failure).toBeInstanceOf(AggregateError)
      const errors = (failure as AggregateError).errors
      expect(errors).toHaveLength(2)
      expect(errors[0].message).toBe("expected migration failure")
      expect(errors[1]).toBe(closeFailure)
    },
  )
})

test("cleanup failure rejects an otherwise successful generation", async () => {
  await isolated(
    "exports.up = (pgm) => pgm.createTable('probe', { id: 'id' })",
    async (options) => {
      closeFailure = new Error("expected cleanup failure")
      await expect(generate(options)).rejects.toBe(closeFailure)
    },
  )
})
