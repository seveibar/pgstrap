import * as zg from "zapatos/generate"
import { getConnectionStringFromEnv } from "pg-connection-from-env"
import type { AddressInfo } from "node:net"
import type { Context } from "./get-project-context"
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
}): Promise<void> => {
  dbDir = dbDir ?? "./src/db"
  migrationsDir = migrationsDir ?? path.join(dbDir, "migrations")

  if (pglite) {
    const { PGlite } = await import("@electric-sql/pglite")
    const { fromNodeSocket } = await import("pg-gateway/node")
    const net = await import("node:net")

    const db = new PGlite()
    const prevDbUrl = process.env.DATABASE_URL
    let server: ReturnType<typeof net.createServer> | undefined

    try {
      await migrate({
        client: db as any,
        migrationsDir,
        defaultDatabase,
        cwd: process.cwd(),
        schemas,
      })

      const pgliteServer = net.createServer(async (socket) => {
        await fromNodeSocket(socket, {
          serverVersion: "16.3 (PGlite)",
          auth: {
            method: "password",
            validateCredentials: ({
              username,
              password,
            }: {
              username: string
              password: string
            }) => username === "postgres" && password === "postgres",
            getClearTextPassword: () => "postgres",
          },
          async onStartup(): Promise<void> {
            await (db as any).waitReady
          },
          async onMessage(
            data: Uint8Array,
            { isAuthenticated }: { isAuthenticated: boolean },
          ): Promise<Uint8Array | undefined> {
            if (!isAuthenticated) return undefined
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
      server = pgliteServer

      await new Promise<void>((resolve) => pgliteServer.listen(0, resolve))
      const address = pgliteServer.address() as AddressInfo
      const connectionString = `postgres://postgres:postgres@127.0.0.1:${address.port}/postgres`

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
      const openServer = server

      if (openServer) {
        await new Promise<void>((resolve, reject) => {
          openServer.close((error?: Error) => {
            if (error) {
              reject(error)
              return
            }

            resolve()
          })
        })
      }

      if (prevDbUrl === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = prevDbUrl
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
