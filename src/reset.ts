import {
  getConnectionStringFromEnv,
  getPgConnectionFromEnv,
} from "pg-connection-from-env"
import { Context } from "./get-project-context"
import { migrate } from "./migrate"
import { Client } from "pg"

export const reset = async (ctx: Context) => {
  const postgres_client = new Client({
    connectionString: getConnectionStringFromEnv({
      database: "postgres",
    }),
  })

  await postgres_client.connect()

  const { database } = getPgConnectionFromEnv({
    fallbackDefaults: {
      database: ctx.defaultDatabase,
    },
  })

  if (database === "postgres") {
    throw new Error(
      `You default database cannot be "postgres" when using pgstrap`,
    )
  }

  console.log(`Dropping database "${database}"...`)
  await postgres_client
    .query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`)
    .catch((error: Error) => {
      if (error.message.includes(`database "${database}" does not exist`))
        return
      throw error
    })

  console.log(`Creating database "${database}"...`)
  await postgres_client.query(`CREATE DATABASE ${database};`)
  await postgres_client.end()

  // This db client is now connected to sp_api
  console.log("Running migrations...")
  await migrate(ctx)

  console.log("Finished migrating")
}
