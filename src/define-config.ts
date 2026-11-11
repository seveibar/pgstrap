export interface PgstrapConfig {
  defaultDatabase: string
  schemas: string[]

  dbDir?: string
  migrationsDir?: string
  pglite?: boolean
}

export const defineConfig = (config: PgstrapConfig) => config
