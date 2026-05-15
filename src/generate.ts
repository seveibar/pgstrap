import * as zg from "zapatos/generate"
import {
  getConnectionStringFromEnv,
  getPgConnectionFromEnv,
} from "pg-connection-from-env"
import { Context } from "./get-project-context"
import { dumpTree } from "pg-schema-dump"
import path from "path"
import { migrate } from "./migrate"

const closeServer = (server: import("node:net").Server) =>
  new Promise<void>((resolve, reject) => {
    server.close((error?: Error) => {
      if (error) reject(error)
      else resolve()
    })
  })

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
    const prevDbUrl = process.env.DATABASE_URL
    let server: import("node:net").Server | undefined
    let shouldRestoreDbUrl = false
    let generateError: unknown

    try {
      await migrate({
        client: db as any,
        migrationsDir,
        defaultDatabase,
        cwd: process.cwd(),
        schemas,
      })

      const gatewayServer = net.createServer(async (socket) => {
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
      server = gatewayServer

      await new Promise<void>((resolve) => gatewayServer.listen(0, resolve))
      const port = (gatewayServer.address() as any).port
      const connectionString = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`

      process.env.DATABASE_URL = connectionString
      shouldRestoreDbUrl = true

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
      generateError = error
      throw error
    } finally {
      if (shouldRestoreDbUrl) {
        if (prevDbUrl === undefined) delete process.env.DATABASE_URL
        else process.env.DATABASE_URL = prevDbUrl
      }

      const closePglite = (db as { close?: () => void | Promise<void> }).close
      let cleanupError: unknown

      try {
        if (server?.listening) await closeServer(server)
      } catch (error) {
        cleanupError = error
      }

      try {
        if (typeof closePglite === "function") await closePglite.call(db)
      } catch (error) {
        cleanupError ??= error
      }

      if (generateError === undefined && cleanupError !== undefined) {
        throw cleanupError
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
