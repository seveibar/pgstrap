import * as zg from "zapatos/generate"
import {
  getConnectionStringFromEnv,
  getPgConnectionFromEnv,
} from "pg-connection-from-env"
import { Context } from "./get-project-context"
import { dumpTree } from "pg-schema-dump"
import path from "path"
import { migrate } from "./migrate"

// pg-schema-dump discovers its connection via process-wide environment keys.
// Concurrent callers must never borrow each other's temporary PGlite URL.
// Keep only the environment-dependent generation phase serial; migrations
// and PGlite initialization can still happen concurrently.
let gatewayEnvTurn: Promise<void> = Promise.resolve()
function acquireGatewayEnv(): Promise<() => void> {
  const previous = gatewayEnvTurn
  let release!: () => void
  gatewayEnvTurn = new Promise<void>((resolve) => {
    release = resolve
  })
  return previous.then(() => release)
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
    const sockets = new Set<import("node:net").Socket>()
    let server: import("node:net").Server | undefined
    let restoreDbUrl: (() => void) | undefined
    let releaseGatewayEnv: (() => void) | undefined

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
              const { data: responseData } = await (db as any).execProtocol(
                data,
              )
              return responseData
            },
          })
        } catch {
          socket.destroy()
        }
      })

      const listeningServer = server
      await new Promise<void>((resolve, reject) => {
        listeningServer.once("error", reject)
        listeningServer.listen(0, "127.0.0.1", () => {
          listeningServer.off("error", reject)
          resolve()
        })
      })
      const port = (server.address() as import("node:net").AddressInfo).port
      const connectionString = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`

      releaseGatewayEnv = await acquireGatewayEnv()
      // pg-schema-dump resolves multiple PostgreSQL URI environment aliases.
      // Set them all to our ephemeral loopback gateway so an existing
      // POSTGRES_URI or PG_URI cannot redirect offline generation to a real
      // database. Restore every previous value even when output fails.
      const connectionKeys = [
        "POSTGRES_URI",
        "POSTGRES_URL",
        "PG_URI",
        "DATABASE_URL",
      ] as const
      const previousUrls = connectionKeys.map((key) => process.env[key])
      restoreDbUrl = () => {
        connectionKeys.forEach((key, index) => {
          const previous = previousUrls[index]
          if (previous === undefined) delete process.env[key]
          else process.env[key] = previous
        })
      }
      for (const key of connectionKeys) {
        process.env[key] = connectionString
      }

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
      try {
        restoreDbUrl?.()
      } finally {
        releaseGatewayEnv?.()
      }
      try {
        // Failed clients may still hold sockets; close them before waiting
        // for the listener so a failed CLI invocation cannot hang on cleanup.
        for (const socket of sockets) socket.destroy()
        if (server?.listening) {
          const listeningServer = server
          await new Promise<void>((resolve) =>
            listeningServer.close(() => resolve()),
          )
        }
      } finally {
        await db.close()
      }
    }

    return
  }

  // Explicit external-Postgres calls share the same environment-dependent
  // generation gate. Otherwise they could read a concurrent embedded call's
  // temporary loopback URL instead of the caller's configured database.
  const releaseExternalEnv = await acquireGatewayEnv()
  try {
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
  } finally {
    releaseExternalEnv()
  }
}
