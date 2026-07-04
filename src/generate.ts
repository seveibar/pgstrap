import * as zg from "zapatos/generate"
import { getConnectionStringFromEnv } from "pg-connection-from-env"
import { Context } from "./get-project-context"
import { dumpTree } from "pg-schema-dump"
import path from "path"
import { migrate } from "./migrate"
import { Client } from "pg"

type GenerateMode = "auto" | "pglite" | "postgres"
type GenerateRuntimeContext = Pick<Context, "schemas" | "defaultDatabase"> & {
  dbDir: string
}

const getSchemasConfig = (schemas: string[]) =>
  Object.fromEntries(
    schemas.map((s) => [s, { include: "*" as const, exclude: [] as string[] }]),
  )

const getPostgresConnectionString = (defaultDatabase: string) =>
  getConnectionStringFromEnv({
    fallbackDefaults: {
      database: defaultDatabase,
    },
  })

const isPostgresUnavailableError = (error: unknown) => {
  const err = error as { code?: string; message?: string; cause?: unknown }
  const cause = err.cause as { code?: string } | undefined
  const code = err.code ?? cause?.code
  if (
    code &&
    [
      "ECONNREFUSED",
      "ECONNRESET",
      "ENOTFOUND",
      "ETIMEDOUT",
      "EHOSTUNREACH",
      "ENETUNREACH",
    ].includes(code)
  ) {
    return true
  }

  const message = String(err.message ?? error)
  return /timeout expired|Connection terminated unexpectedly|connect .* refused/i.test(
    message,
  )
}

const canConnectToPostgres = async (connectionString: string) => {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 1500,
  })

  try {
    await client.connect()
    return true
  } catch (error) {
    if (isPostgresUnavailableError(error)) return false
    throw error
  } finally {
    await client.end().catch(() => undefined)
  }
}

const getGenerateMode = (pglite?: boolean | "auto"): GenerateMode => {
  if (pglite === true) return "pglite"
  if (pglite === false) return "postgres"
  return "auto"
}

const withDatabaseUrl = async <T>(
  connectionString: string,
  fn: () => Promise<T>,
) => {
  const prevDbUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = connectionString

  try {
    return await fn()
  } finally {
    if (prevDbUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = prevDbUrl
  }
}

const generateUsingConnectionString = async ({
  connectionString,
  schemas,
  defaultDatabase,
  dbDir,
  setDatabaseUrl = false,
}: GenerateRuntimeContext & {
  connectionString: string
  setDatabaseUrl?: boolean
}) => {
  const run = async () => {
    await zg.generate({
      db: {
        connectionString,
      },
      schemas: getSchemasConfig(schemas),
      outDir: dbDir,
    })

    await dumpTree({
      targetDir: path.join(dbDir, "structure"),
      defaultDatabase,
      schemas,
    })
  }

  if (setDatabaseUrl) {
    return withDatabaseUrl(connectionString, run)
  }

  return run()
}

const generateWithPglite = async ({
  schemas,
  defaultDatabase,
  dbDir,
  migrationsDir,
}: GenerateRuntimeContext & {
  migrationsDir: string
}) => {
  const { PGlite } = await import("@electric-sql/pglite")
  const { fromNodeSocket } = await import("pg-gateway/node")
  const net = await import("node:net")

  const db = new PGlite()
  await db.waitReady

  await migrate({
    client: db as any,
    migrationsDir,
    defaultDatabase,
    cwd: process.cwd(),
    schemas,
  })

  const sockets = new Set<import("node:net").Socket>()
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))

    fromNodeSocket(socket, {
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
        try {
          const { data: responseData } = await db.execProtocol(data)
          return responseData
        } catch {
          return undefined
        }
      },
    }).catch((error) => socket.destroy(error))
  })

  try {
    await new Promise<void>((resolve) => server.listen(0, resolve))
    const port = (server.address() as any).port
    const connectionString = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`

    await generateUsingConnectionString({
      connectionString,
      schemas,
      defaultDatabase: "postgres",
      dbDir,
      setDatabaseUrl: true,
    })
  } finally {
    for (const socket of sockets) socket.destroy()
    if (server.listening) {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    }
    await db.close()
  }
}

export const generate = async ({
  schemas,
  defaultDatabase,
  dbDir,
  pglite = "auto",
  migrationsDir,
}: Pick<Context, "schemas" | "defaultDatabase" | "dbDir"> & {
  pglite?: boolean | "auto"
  migrationsDir?: string
}) => {
  dbDir = dbDir ?? "./src/db"
  migrationsDir = migrationsDir ?? path.join(dbDir, "migrations")
  const mode = getGenerateMode(pglite)

  if (mode === "pglite") {
    await generateWithPglite({
      schemas,
      defaultDatabase,
      dbDir,
      migrationsDir,
    })
    return
  }

  const connectionString = getPostgresConnectionString(defaultDatabase)

  if (mode === "auto") {
    const postgresAvailable = await canConnectToPostgres(connectionString)
    if (!postgresAvailable) {
      console.info("Postgres unavailable; generating with PGlite.")
      await generateWithPglite({
        schemas,
        defaultDatabase,
        dbDir,
        migrationsDir,
      })
      return
    }
  }

  await generateUsingConnectionString({
    connectionString,
    schemas,
    defaultDatabase,
    dbDir,
  })
}
