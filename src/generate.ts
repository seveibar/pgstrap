import * as zg from "zapatos/generate"
import {
  getConnectionStringFromEnv,
  getPgConnectionFromEnv,
} from "pg-connection-from-env"
import { Context } from "./get-project-context"
import { dumpTree } from "pg-schema-dump"
import path from "path"
import { migrate } from "./migrate"

export const generate = async ({
  schemas,
  defaultDatabase,
  dbDir,
  pglite = false,
  migrationsDir,
}: Pick<Context, "schemas" | "defaultDatabase" | "dbDir"> & {
  pglite?: boolean
  migrationsDir?: string
}) => {
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
          await db.waitReady
        },
        async onMessage(data: Uint8Array, { isAuthenticated }: any) {
          if (!isAuthenticated) return
          const { data: responseData } = await db.execProtocol(data, {
            throwOnError: false,
          })
          return responseData
        },
      }).catch(() => socket.destroy())
    })

    const previousPostgresUri = process.env.POSTGRES_URI
    let connectionOverrideActive = false
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
          server.off("error", reject)
          resolve()
        })
      })
      const port = (server.address() as import("node:net").AddressInfo).port
      const connectionString = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`

      // pg-schema-dump resolves this before PG_URI and DATABASE_URL.
      // Its temporary connection must not fall back to a configured server.
      process.env.POSTGRES_URI = connectionString
      connectionOverrideActive = true

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
      if (connectionOverrideActive) {
        if (previousPostgresUri === undefined) delete process.env.POSTGRES_URI
        else process.env.POSTGRES_URI = previousPostgresUri
      }
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
