import * as zg from "zapatos/generate"
import {
  getConnectionStringFromEnv,
  getPgConnectionFromEnv,
} from "pg-connection-from-env"
import { Context } from "./get-project-context"
import { dumpTree } from "pg-schema-dump"
import path from "path"
import { migrate } from "./migrate"

const missingConnectionDefaults = {
  host: "\0",
  user: "\0",
  port: -1,
  database: "\0",
  password: "\0",
}

const emptyConnection = getPgConnectionFromEnv({
  env: {},
  fallbackDefaults: missingConnectionDefaults,
})

const hasConfiguredConnection = (env: NodeJS.ProcessEnv) => {
  const normalizedEnv: Record<string, string> = {}

  for (const [name, value] of Object.entries(env)) {
    const normalizedValue = value?.trim()
    if (normalizedValue) normalizedEnv[name] = normalizedValue
  }

  const connection = getPgConnectionFromEnv({
    env: normalizedEnv,
    fallbackDefaults: missingConnectionDefaults,
  })

  return JSON.stringify(connection) !== JSON.stringify(emptyConnection)
}

export const shouldUsePglite = ({
  pglite,
  env = process.env,
}: {
  pglite?: boolean
  env?: NodeJS.ProcessEnv
}) => pglite ?? !hasConfiguredConnection(env)

export const generate = async ({
  schemas,
  defaultDatabase,
  dbDir,
  pglite,
  migrationsDir,
}: Pick<Context, "schemas" | "defaultDatabase" | "dbDir"> & {
  pglite?: boolean
  migrationsDir?: string
}) => {
  dbDir = dbDir ?? "./src/db"
  migrationsDir = migrationsDir ?? path.join(dbDir, "migrations")
  const usePglite = shouldUsePglite({ pglite, env: process.env })

  if (usePglite) {
    const { PGlite } = await import("@electric-sql/pglite")
    const { fromNodeSocket } = await import("pg-gateway/node")
    const net = await import("node:net")

    const db = new PGlite()
    const server = net.createServer(async (socket) => {
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

    // point every PostgreSQL connection env var at the temporary PGlite
    // server: zapatos reads DATABASE_URL, but pg-schema-dump resolves
    // POSTGRES_URI, PG_URI and DATABASE_URI with higher precedence
    const connectionEnvVars = [
      "DATABASE_URL",
      "DATABASE_URI",
      "PG_URI",
      "POSTGRES_URI",
    ] as const
    const previousValues = connectionEnvVars.map((name) => ({
      name,
      value: process.env[name],
    }))

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
        server.listen(0, () => resolve())
      })
      const port = (server.address() as any).port
      const connectionString = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`
      for (const name of connectionEnvVars) {
        process.env[name] = connectionString
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
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await (db as any).close()
      for (const { name, value } of previousValues) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
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
