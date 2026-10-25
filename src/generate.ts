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
  pglite = true,
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
    const prevDbUrl = process.env.DATABASE_URL
    let changedDbUrl = false
    let generationFailed = false

    try {
      await migrate({
        client: db as any,
        migrationsDir,
        defaultDatabase,
        cwd: process.cwd(),
        schemas,
      })

      server = net.createServer((socket) => {
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
            const { data: responseData } = await db.runExclusive(() =>
              db.execProtocol(data, { throwOnError: false }),
            )
            return responseData
          },
        }).catch(() => socket.destroy())
      })

      await new Promise<void>((resolve, reject) => {
        server!.once("error", reject)
        server!.listen(0, "127.0.0.1", () => {
          server!.off("error", reject)
          resolve()
        })
      })
      const port = (server.address() as import("node:net").AddressInfo).port
      const connectionString = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`

      process.env.DATABASE_URL = connectionString
      changedDbUrl = true

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
    } catch (error) {
      generationFailed = true
      throw error
    } finally {
      if (changedDbUrl) {
        if (prevDbUrl === undefined) delete process.env.DATABASE_URL
        else process.env.DATABASE_URL = prevDbUrl
      }

      try {
        try {
          const closed = server?.listening
            ? new Promise<void>((resolve, reject) => {
                server!.close((error) => (error ? reject(error) : resolve()))
              })
            : undefined
          // net.Server has no closeAllConnections(); close accepted sockets too.
          for (const socket of sockets) socket.destroy()
          await closed
        } finally {
          await db.close()
        }
      } catch (error) {
        // Preserve the original generation error if cleanup also fails.
        if (!generationFailed) throw error
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
