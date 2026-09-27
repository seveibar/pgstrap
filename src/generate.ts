import * as zg from "zapatos/generate"
import { getConnectionStringFromEnv } from "pg-connection-from-env"
import { Context } from "./get-project-context"
import { dumpTree } from "pg-schema-dump"
import path from "path"
import type { AddressInfo, Socket } from "node:net"
import { spawn } from "node:child_process"
import { migrate } from "./migrate"

// pg-schema-dump only accepts connection settings via the environment. Give it
// an isolated process so application URLs cannot override the local gateway,
// and concurrent callers never observe or restore each other's DATABASE_URL.
const dumpPgliteTree = (
  connectionString: string,
  options: Parameters<typeof dumpTree>[0],
) =>
  new Promise<void>((resolve, reject) => {
    const script = `require(${JSON.stringify(require.resolve("pg-schema-dump"))})
      .dumpTree(${JSON.stringify(options)})
      .catch(error => {
        // The dependency can leave a socket open on query errors. This worker
        // owns no caller resources, so exit after the diagnostic is flushed.
        process.stderr.write("Schema dump failed: " + String(error.message) + "\\n", () => process.exit(1))
      })`
    const child = spawn(process.execPath, ["--eval", script], {
      env: {
        ...process.env,
        POSTGRES_URI: connectionString,
        PG_URI: connectionString,
        DATABASE_URL: connectionString,
        DATABASE_URI: connectionString,
        PGSSLMODE: "disable",
      },
      stdio: ["ignore", "inherit", "pipe"],
    })
    let stderr = ""
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-65_536)
    })
    child.once("error", reject)
    child.once("close", (code, signal) => {
      if (code === 0) resolve()
      else
        reject(
          new Error(stderr.trim() || `Schema dump failed (${signal ?? code})`),
        )
    })
  })

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

  if (pglite) {
    const { PGlite } = await import("@electric-sql/pglite")
    const { fromNodeSocket } = await import("pg-gateway/node")
    const net = await import("node:net")

    const db = new PGlite()

    const sockets = new Set<Socket>()
    const server = net.createServer((socket) => {
      sockets.add(socket)
      socket.once("close", () => sockets.delete(socket))
      fromNodeSocket(socket, {
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
        server.listen(0, "127.0.0.1", () => {
          server.removeListener("error", reject)
          resolve()
        })
      })
      const port = (server.address() as AddressInfo).port
      const connectionString = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`
      await zg.generate({
        db: { connectionString, ssl: false },
        schemas: Object.fromEntries(
          schemas.map((s) => [s, { include: "*", exclude: [] }]),
        ),
        outDir: dbDir,
      })

      await dumpPgliteTree(connectionString, {
        targetDir: path.join(dbDir, "structure"),
        defaultDatabase: "postgres",
        schemas,
      })
    } finally {
      for (const socket of sockets) socket.destroy()
      try {
        if (server.listening) {
          await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()))
          })
        }
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
