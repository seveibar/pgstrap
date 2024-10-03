// pgstrap.ts
import * as nodePgMigrateModule from "node-pg-migrate"
import { Client } from "pg"
import Debug from "debug"
import path from "path"
import {
  getConnectionStringFromEnv,
  getPgConnectionFromEnv,
} from "pg-connection-from-env"
import * as childProcess from "child_process"
import { Context } from "./get-project-context"

const debug = Debug("pgstrap")

export async function createMigration(name: string, ctx: Context) {
  childProcess.execSync(
    `npx node-pg-migrate --migration-file-language ts -m ${
      ctx.dbDir ?? "src/db"
    }/migrations create ${name}`,
  )
  console.log(`Migration ${name} created`)
}

export async function migrate(
  ctx: Context & {
    databaseUrl?: string
    migrationsDir?: string
    client?: Client
  },
) {
  if (!ctx.migrationsDir && ctx.dbDir) {
    ctx.migrationsDir = path.join(ctx.dbDir, "migrations")
  }

  const client =
    ctx.client ??
    new Client(
      ctx.databaseUrl ??
        getConnectionStringFromEnv({
          fallbackDefaults: {
            database: ctx.defaultDatabase,
          },
        }),
    )

  // pglite compat
  if ("connect" in client) {
    await client.connect()
  }

  let logger =
    debug.enabled || process.env.NODE_ENV !== "test"
      ? console
      : {
          ...console,
          info: () => null,
          log: () => null,
        }

  const runMigrations = () =>
    // some es import bug when it's built- something with interop
    (
      (nodePgMigrateModule as any).default.default ??
      nodePgMigrateModule.default
    )({
      dbClient: client,
      direction: "up",
      schema: "public",
      createSchema: true,
      createMigrationsSchema: true,
      migrationsSchema: "migrations",
      migrationsTable: "pgmigrations",
      verbose: false,
      dir: ctx.migrationsDir ?? path.join(ctx.cwd, "src/db/migrations"),
      logger,
    })

  logger.info("Running migrations...")
  try {
    await runMigrations()
  } catch (err: any) {
    if (
      err
        .toString()
        .includes("SyntaxError: Cannot use import statement outside a module")
    ) {
      console.log(
        "Couldn't load migrations due to import issue, using esbuild-register to enable import...",
      )
      require("esbuild-register")
      await runMigrations()
    } else {
      throw err
    }
  }

  if ("end" in client) {
    await client.end()
  }

  // debug only
  // console.log("Migrations completed")
}
