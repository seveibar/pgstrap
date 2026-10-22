export interface PgstrapConfig {
  defaultDatabase: string
  schemas: string[]

  dbDir?: string
  pglite?: boolean
}

export const defineConfig = (config: PgstrapConfig) => config
