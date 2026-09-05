import * as zg from "zapatos/generate"
import { getConnectionStringFromEnv } from "pg-connection-from-env"
import type { Context } from "./get-project-context"
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

// dumpTree reads process.env instead of accepting a connection. Serialize all
// generation calls, including Postgres calls, so none sees another's override.
let generationQueue: Promise<void> = Promise.resolve()

export const generate = (options: GenerateOptions): Promise<void> => {
  const result = generationQueue.then(() => generateOnce(options))
  generationQueue = result.catch(() => {})
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
    let closing = false
    const server = net.createServer((socket) => {
      if (closing) {
        socket.destroy()
        return
      }
      sockets.add(socket)
      socket.once("close", () => sockets.delete(socket))
      void fromNodeSocket(socket, {
        serverVersion: "16.3 (PGlite)",
        auth: {
          method: "password",
          validateCredentials: ({ username, password }) =>
            username === "postgres" && password === "postgres",
          getClearTextPassword: () => "postgres",
        },
        async onStartup() {
          await db.waitReady
        },
        async onMessage(data, { isAuthenticated }) {
          if (!isAuthenticated) return
          try {
            const { data: responseData } = await db.execProtocol(data, {
              throwOnError: false,
            })
            return responseData
          } catch {
            socket.destroy()
            return undefined
          }
        },
      }).catch(() => socket.destroy())
    })

    try {
      await db.waitReady
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

      await zg.generate({
        db: { connectionString },
        schemas: Object.fromEntries(
          schemas.map((s) => [s, { include: "*", exclude: [] }]),
        ),
        outDir: dbDir,
      })

      // This resolver checks POSTGRES_URI before PG_URI and DATABASE_URL.
      // Override only its highest-priority input, only while dumping.
      const previousUri = process.env.POSTGRES_URI
      try {
        process.env.POSTGRES_URI = connectionString
        await dumpTree({
          targetDir: path.join(dbDir, "structure"),
          defaultDatabase: "postgres",
          schemas,
        })
      } finally {
        if (previousUri === undefined) delete process.env.POSTGRES_URI
        else process.env.POSTGRES_URI = previousUri
      }
    } finally {
      closing = true
      try {
        await new Promise<void>((resolve, reject) => {
          if (server.listening) {
            server.close((error) => (error ? reject(error) : resolve()))
          } else {
            resolve()
          }
          for (const socket of sockets) socket.destroy()
        })
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
