export default `import { Kysely, PostgresDialect } from "kysely"
import { Pool } from "pg"
import pgmConfig from "../../pgstrap.config"
import { KyselyDatabaseInstance } from "./kysely-types"
import { getConnectionStringFromEnv } from "pg-connection-from-env"

export const getDbClient = (): KyselyDatabaseInstance => {
  return new Kysely({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: getConnectionStringFromEnv({
          fallbackDefaults: {
            database: pgmConfig.defaultDatabase,
          },
        }),
      }),
    }),
  })
}`
