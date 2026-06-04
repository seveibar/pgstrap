import * as zg from "zapatos/generate"
import { getConnectionStringFromEnv } from "pg-connection-from-env"
import { Context } from "./get-project-context"
import { dumpTree } from "pg-schema-dump"
import path from "path"
import { migrate } from "./migrate"

const postgresEnvKeys = [
  "DATABASE_URL",
  "PGHOST",
  "PGPORT",
  "PGDATABASE",
  "PGUSER",
  "PGPASSWORD",
]

const hasExternalDatabaseConfig = (
  env: Record<string, string | undefined> = process.env,
) => postgresEnvKeys.some((key) => Boolean(env[key]))

const generateWithPglite = async ({
  schemas,
  defaultDatabase,
  dbDir,
  migrationsDir,
}: Pick<Context, "schemas" | "defaultDatabase" | "dbDir"> & {
  migrationsDir: string
}) => {
  const { PGlite } = await import("@electric-sql/pglite")
  const { fromNodeSocket } = await import("pg-gateway/node")
  const net = await import("node:net")

  const db = new PGlite()
  const server = net.createServer(async (socket) => {
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
          const { data: responseData } = await (db as any).execProtocol(data)
          return responseData
        } catch {
          return undefined
        }
      },
    })
  })

  const prevDbUrl = process.env.DATABASE_URL

  try {
    await migrate({
      client: db as any,
      migrationsDir,
      defaultDatabase,
      cwd: process.cwd(),
      schemas,
    })

    await new Promise<void>((resolve) => server.listen(0, resolve))
    const port = (server.address() as any).port
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
    if (prevDbUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = prevDbUrl

    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err)
        else resolve()
      })
    }).catch(() => null)

    await (db as any).close?.()
  }
}

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

  if (pglite || !hasExternalDatabaseConfig()) {
    await generateWithPglite({
      schemas,
      defaultDatabase,
      dbDir,
      migrationsDir,
    })
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
