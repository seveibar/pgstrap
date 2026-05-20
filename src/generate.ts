import * as zg from "zapatos/generate"
import { getConnectionStringFromEnv } from "pg-connection-from-env"
import { Context } from "./get-project-context"
import { dumpTree } from "pg-schema-dump"
import path from "path"
import { migrate } from "./migrate"

const restoreDatabaseUrl = (previousDatabaseUrl: string | undefined) => {
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
  else process.env.DATABASE_URL = previousDatabaseUrl
}

const closeServer = async (server: import("node:net").Server) => {
  if (!server.listening) return

  await new Promise<void>((resolve) => {
    server.close(() => resolve())
  })
}

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
    const previousDatabaseUrl = process.env.DATABASE_URL
    let server: import("node:net").Server | undefined

    try {
      await migrate({
        client: db as any,
        migrationsDir,
        defaultDatabase,
        cwd: process.cwd(),
        schemas,
      })

      const activeServer = net.createServer(async (socket) => {
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
      })
      server = activeServer

      await new Promise<void>((resolve) => activeServer.listen(0, resolve))
      const port = (activeServer.address() as any).port
      const connectionString = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`

      process.env.DATABASE_URL = connectionString

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
      restoreDatabaseUrl(previousDatabaseUrl)
      if (server) await closeServer(server)
      await (db as any).close?.()
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
