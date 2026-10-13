import * as zg from "zapatos/generate"
import {
  getConnectionStringFromEnv,
  getPgConnectionFromEnv,
} from "pg-connection-from-env"
import { Context } from "./get-project-context"
import { dumpTree } from "pg-schema-dump"
import path from "path"
import { migrate } from "./migrate"

type GenerateOptions = Pick<
  Context,
  "schemas" | "defaultDatabase" | "dbDir"
> & {
  pglite?: boolean
  migrationsDir?: string
}

let pendingGeneration: Promise<void> = Promise.resolve()
const databaseUriKeys = [
  "POSTGRES_URI",
  "PG_URI",
  "DATABASE_URL",
  "DATABASE_URI",
] as const

export const generate = (options: GenerateOptions) => {
  // dumpTree reads process-wide URI aliases, so generation must not overlap.
  const result = pendingGeneration.then(() => generateOnce(options))
  pendingGeneration = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

const generateOnce = async ({
  schemas,
  defaultDatabase,
  dbDir,
  pglite = true,
  migrationsDir,
}: GenerateOptions) => {
  dbDir = dbDir ?? "./src/db"
  migrationsDir = migrationsDir ?? path.join(dbDir, "migrations")

  if (pglite) {
    const { PGlite } = await import("@electric-sql/pglite")
    const { fromNodeSocket } = await import("pg-gateway/node")
    const net = await import("node:net")

    const db = new PGlite()

    const sockets = new Set<import("node:net").Socket>()
    const server = net.createServer((socket) => {
      sockets.add(socket)
      socket.once("close", () => sockets.delete(socket))
      void fromNodeSocket(socket, {
        serverVersion: "16.3 (PGlite)",
        auth: {
          method: "password",
          validateCredentials: ({ username, password }: any) =>
            username === "postgres" && password === "postgres",
          getClearTextPassword: () => "postgres",
        },
        async onStartup() {
          await (db as any).waitReady
        },
        async onMessage(data: Uint8Array, { isAuthenticated }: any) {
          if (!isAuthenticated) return
          try {
            const { data: responseData } = await (db as any).execProtocol(data)
            return responseData
          } catch {
            return undefined
          }
        },
      }).catch(() => socket.destroy())
    })
    const previousUris = databaseUriKeys.map((key) => process.env[key])
    try {
      await migrate({
        client: db as any,
        migrationsDir,
        defaultDatabase,
        cwd: process.cwd(),
        schemas,
      })

      await new Promise<void>((resolve, reject) => {
        server.once("error", reject)
        server.listen(0, "127.0.0.1", () => {
          server.removeListener("error", reject)
          resolve()
        })
      })
      const port = (server.address() as import("node:net").AddressInfo).port
      const connectionString = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`
      for (const key of databaseUriKeys) process.env[key] = connectionString

      await zg.generate({
        db: { connectionString },
        schemas: Object.fromEntries(
          schemas.map((s) => [s, { include: "*", exclude: [] }]),
        ),
        outDir: dbDir,
      })

      await dumpTree({
        targetDir: path.join(dbDir, "structure"),
        defaultDatabase: "postgres",
        schemas,
      })
    } finally {
      databaseUriKeys.forEach((key, index) => {
        const previous = previousUris[index]
        if (previous === undefined) delete process.env[key]
        else process.env[key] = previous
      })
      for (const socket of sockets) socket.destroy()
      try {
        if (server.listening) {
          await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()))
          })
        }
      } finally {
        await db.close()
      }
    }
    return
  }

  await zg.generate({
    db: {
      connectionString: getConnectionStringFromEnv({
        fallbackDefaults: {
          database: defaultDatabase,
        },
      }),
    },
    schemas: Object.fromEntries(
      schemas.map((s) => [
        s,
        {
          include: "*",
          exclude: [],
        },
      ]),
    ),
    outDir: dbDir,
  })

  await dumpTree({
    targetDir: path.join(dbDir, "structure"),
    defaultDatabase,
    schemas,
  })
}
