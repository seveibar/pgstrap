import * as zg from "zapatos/generate"
import { getConnectionStringFromEnv } from "pg-connection-from-env"
import { Context } from "./get-project-context"
import { dumpTree } from "pg-schema-dump"
import path from "path"
import { PGlite } from "@electric-sql/pglite"
import net from "net"
import { fromNodeSocket } from "pg-gateway/node"
import { migrate } from "./migrate"

export const generate = async ({
  schemas,
  defaultDatabase,
  dbDir,
}: Pick<Context, "schemas" | "defaultDatabase" | "dbDir">) => {
  dbDir = dbDir ?? "./src/db"

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

export const generateWithPglite = async (
  ctx: Context & { migrationsDir?: string },
) => {
  const db = new PGlite()

  const migrationsDir =
    ctx.migrationsDir ?? path.join(ctx.dbDir ?? "./src/db", "migrations")

  await migrate({
    ...ctx,
    migrationsDir,
    client: db as any,
  })

  const server = net.createServer(async (socket) => {
    const connection = await fromNodeSocket(socket as any, {
      auth: { method: "trust" },
      async onStartup() {
        await db.waitReady
        return false
      },
      async onMessage(data: any, { isAuthenticated }: any) {
        if (!isAuthenticated) return false

        try {
          const [[_, responseData]] = (await db.execProtocol(
            data as any,
          )) as any
          connection.sendData(responseData)
        } catch (err) {
          connection.sendError(err as Error)
          connection.sendReadyForQuery()
        }
        return true
      },
    })

    socket.on("end", () => {
      // connection cleanup if needed
    })
  })

  await new Promise<void>((resolve) => server.listen(0, () => resolve()))
  server.unref()
  const port = (server.address() as net.AddressInfo).port
  const prevUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = `postgres://localhost:${port}`

  try {
    await generate(ctx)
  } finally {
    if (prevUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = prevUrl
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await db.close()
  }
}
