export interface PgstrapConfig {
  defaultDatabase: string
  schemas: string[]

  dbDir?: string
}

export const defineConfig = (config: PgstrapConfig) => config
