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

export const hasExternalDatabaseConfig = (
  env: Record<string, string | undefined> = process.env,
) => postgresEnvKeys.some((key) => Boolean(env[key]))

let pgliteEnvLock = Promise.resolve()

const withPgliteEnvLock = async <T>(fn: () => Promise<T>) => {
  const previous = pgliteEnvLock
  let release!: () => void
  pgliteEnvLock = new Promise<void>((resolve) => {
    release = resolve
  })

  await previous
  try {
    return await fn()
  } finally {
    release()
  }
}

const generateWithPglite = async ({
  schemas,
  defaultDatabase,
  dbDir,
  migrationsDir,
}: Pick<Context, "schemas" | "defaultDatabase"> & {
  dbDir: string
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
        } catch (error) {
          if (process.env.DEBUG?.includes("pgstrap")) {
            console.error("PGlite protocol execution failed", error)
          }
          return undefined
        }
      },
    })
  })

  try {
    await migrate({
      client: db as any,
      migrationsDir,
      defaultDatabase,
      cwd: process.cwd(),
      schemas,
    })

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const port = (server.address() as any).port
    const connectionString = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`

    await withPgliteEnvLock(async () => {
      const previousEnv = Object.fromEntries(
        postgresEnvKeys.map((key) => [key, process.env[key]]),
      ) as Record<string, string | undefined>

      try {
        for (const key of postgresEnvKeys) delete process.env[key]
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
        for (const [key, value] of Object.entries(previousEnv)) {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }
      }
    })
  } finally {
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
