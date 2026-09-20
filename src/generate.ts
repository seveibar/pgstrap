import * as zg from "zapatos/generate"
import { getConnectionStringFromEnv } from "pg-connection-from-env"
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
    let server: import("node:net").Server | undefined
    const connectionKeys = [
      "POSTGRES_URI",
      "PG_URI",
      "DATABASE_URL",
      "DATABASE_URI",
    ]
    const previousConnections = connectionKeys.map(
      (key) => [key, process.env[key]] as const,
    )

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
          server!.removeListener("error", reject)
          resolve()
        })
      })
      const port = (server.address() as any).port
      const connectionString = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`

      for (const key of connectionKeys) process.env[key] = connectionString

      await zg.generate({
        db: {
          connectionString,
        },
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
      for (const [key, value] of previousConnections) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      try {
        for (const socket of sockets) socket.destroy()
        if (server?.listening) {
          await new Promise<void>((resolve, reject) => {
            server!.close((error) => (error ? reject(error) : resolve()))
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
