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
    const previousDatabaseUrl = process.env.DATABASE_URL
    const sockets = new Set<import("node:net").Socket>()
    let server: import("node:net").Server | undefined

    try {
      await migrate({
        client: db as any,
        migrationsDir,
        defaultDatabase,
        cwd: process.cwd(),
        schemas,
      })

      server = net.createServer(async (socket) => {
        sockets.add(socket)
        socket.once("close", () => sockets.delete(socket))
        try {
          await fromNodeSocket(socket, {
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
                const { data: responseData } = await (db as any).execProtocol(
                  data,
                )
                return responseData
              } catch {
                return undefined
              }
            },
          })
        } catch {
          socket.destroy()
        }
      })

      await new Promise<void>((resolve, reject) => {
        server!.once("error", reject)
        server!.listen(0, "127.0.0.1", () => {
          server!.off("error", reject)
          resolve()
        })
      })
      const address = server.address() as import("node:net").AddressInfo
      const connectionString = `postgres://postgres:postgres@127.0.0.1:${address.port}/postgres`
      process.env.DATABASE_URL = connectionString

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
      // The temporary connection must not escape on failed type generation or dumps.
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = previousDatabaseUrl
      for (const socket of sockets) socket.destroy()
      if (server?.listening) {
        await new Promise<void>((resolve, reject) => {
          server!.close((error) => (error ? reject(error) : resolve()))
        })
      }
      await db.close()
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
