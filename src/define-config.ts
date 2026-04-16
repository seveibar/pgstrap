export interface PgstrapConfig {
  defaultDatabase: string
  schemas: string[]

  /** Use PGlite instead of a real PostgreSQL connection */
  pglite?: boolean

  dbDir?: string
}

export const defineConfig = (config: PgstrapConfig) => config
