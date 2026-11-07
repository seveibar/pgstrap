import path from "path"
import { getConnectionStringFromEnv } from "pg-connection-from-env"
import { dumpTree } from "pg-schema-dump"
import * as zg from "zapatos/generate"
import type { Context } from "./get-project-context"
import { migrate } from "./migrate"

export type GenerateOptions = Pick<
  Context,
  "schemas" | "defaultDatabase" | "dbDir"
> & {
  pglite?: boolean
  migrationsDir?: string
}

interface PgliteGenerateContext {
  schemas: string[]
  defaultDatabase: string
  dbDir: string
  migrationsDir: string
}

// Build the Zapatos schema inclusion map so every configured Postgres schema
// exports full table and view type definitions.
const buildSchemaConfig = (schemas: string[]) =>
  Object.fromEntries(
    schemas.map((schemaName) => [
      schemaName,
      {
        include: "*",
        exclude: [],
      },
    ]),
  )

// Spin up an ephemeral in-memory PGlite TCP gateway so Zapatos and
// pg-schema-dump can introspect migration state without a running Postgres daemon.
const generateWithPglite = async ({
  schemas,
  defaultDatabase,
  dbDir,
  migrationsDir,
}: PgliteGenerateContext) => {
  const { PGlite } = await import("@electric-sql/pglite")
  const { fromNodeSocket } = await import("pg-gateway/node")
  const net = await import("node:net")

  const db = new PGlite()

  await migrate({
    client: db as any,
    migrationsDir,
    defaultDatabase,
    cwd: process.cwd(),
    schemas,
  })

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

  await new Promise<void>((resolve) => server.listen(0, resolve))
  const port = (server.address() as any).port
  const connectionString = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`

  const prevDbUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = connectionString

  try {
    await zg.generate({
      db: {
        connectionString,
      },
      schemas: buildSchemaConfig(schemas),
      outDir: dbDir,
    })

    await dumpTree({
      targetDir: path.join(dbDir, "structure"),
      defaultDatabase: "postgres",
      schemas,
    })
  } finally {
    server.close()
    if (prevDbUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = prevDbUrl
  }
}

export const generate = async ({
  schemas,
  defaultDatabase,
  dbDir,
  pglite = true,
  migrationsDir,
}: GenerateOptions) => {
  const resolvedDbDir = dbDir ?? "./src/db"
  const resolvedMigrationsDir =
    migrationsDir ?? path.join(resolvedDbDir, "migrations")

  if (pglite) {
    await generateWithPglite({
      schemas,
      defaultDatabase,
      dbDir: resolvedDbDir,
      migrationsDir: resolvedMigrationsDir,
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
    schemas: buildSchemaConfig(schemas),
    outDir: resolvedDbDir,
  })

  await dumpTree({
    targetDir: path.join(resolvedDbDir, "structure"),
    defaultDatabase,
    schemas,
  })
}
