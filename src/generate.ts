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
    const { FrontendMessageCode } = await import("pg-gateway")
    const net = await import("node:net")

    const db = new PGlite()

    const sockets = new Set<import("node:net").Socket>()
    const server = net.createServer((socket) => {
      sockets.add(socket)
      socket.on("close", () => sockets.delete(socket))
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
          // Disconnect this client without terminating the shared database.
          if (!isAuthenticated || data[0] === FrontendMessageCode.Terminate)
            return
          const { data: responseData } = await db.execProtocol(data, {
            throwOnError: false,
          })
          return responseData
        },
      }).catch(() => socket.destroy())
    })

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
        server.listen(0, "127.0.0.1", resolve)
      })
      const port = (server.address() as import("node:net").AddressInfo).port
      const connectionString = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`

      // Zapatos accepts ClientConfig in its types but constructs a pg.Pool.
      // PGlite has a single session; serialize the pool's catalog queries.
      const dbConfig = { connectionString, max: 1 }
      await zg.generate({
        db: dbConfig,
        schemas: Object.fromEntries(
          schemas.map((s) => [s, { include: "*", exclude: [] }]),
        ),
        outDir: dbDir,
      })

      // pg-schema-dump reads its connection from the environment. POSTGRES_URI
      // has priority over PG_URI, DATABASE_URL and DATABASE_URI.
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
      for (const socket of sockets) socket.destroy()
      if (server.listening) {
        await new Promise<void>((resolve) => server.close(() => resolve()))
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
