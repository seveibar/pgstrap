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
    let server: import("node:net").Server | undefined

    // The embedded gateway and the in-memory database must always be released,
    // otherwise a failed generation can leave the process with open handles.
    const teardown = async () => {
      const srv = server
      if (srv) {
        server = undefined
        await new Promise<void>((resolve) => srv.close(() => resolve()))
      }
      await db.close()
    }

    try {
      await migrate({
        client: db as any,
        migrationsDir,
        defaultDatabase,
        cwd: process.cwd(),
        schemas,
      })
    } catch (error) {
      await teardown()
      throw error
    }

    server = net.createServer(async (socket) => {
      const connection = await fromNodeSocket(socket, {
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
            const { data: responseData } = await (db as any).execProtocol(data)
            return responseData
          } catch {
            return undefined
          }
        },
      })
    })

    await new Promise<void>((resolve) => server!.listen(0, resolve))
    const port = (server!.address() as any).port
    const connectionString = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`

    // pg-schema-dump resolves its own connection from the environment through
    // pg-connection-from-env, which prefers POSTGRES_URI/PG_URI over
    // DATABASE_URL and otherwise falls back to the POSTGRES_HOST/POSTGRES_PORT
    // variables. Override every alias so the dump talks to the embedded PGlite
    // gateway and never to the project's own postgres server.
    const uriEnvKeys = [
      "POSTGRES_URI",
      "PG_URI",
      "DATABASE_URL",
      "DATABASE_URI",
    ]
    const hostEnvKeys = [
      "POSTGRES_HOST",
      "POSTGRES_PORT",
      "POSTGRES_USER",
      "POSTGRES_USERNAME",
      "POSTGRES_PASSWORD",
      "POSTGRES_PASS",
      "POSTGRES_DATABASE",
      "POSTGRES_DB",
      "POSTGRES_SSL",
    ]
    const previousEnv = new Map(
      [...uriEnvKeys, ...hostEnvKeys].map((key) => [key, process.env[key]]),
    )
    const restoreEnv = () => {
      for (const [key, value] of previousEnv) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }

    for (const key of uriEnvKeys) process.env[key] = connectionString
    for (const key of hostEnvKeys) delete process.env[key]

    try {
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
      restoreEnv()
      await teardown()
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
