import fs from "fs"
import path from "path"
import { pathToFileURL } from "node:url"
import { PgstrapConfig } from "./define-config"

export interface Context extends PgstrapConfig {
  cwd: string
}

export const getProjectContext = async (): Promise<Context> => {
  if (!fs.existsSync(path.join(process.cwd(), "pgstrap.config.js"))) {
    throw new Error(
      `You must have a pgstrap.config.js file in your project root`,
    )
  }

  const configUrl = pathToFileURL(path.join(process.cwd(), "pgstrap.config.js"))
  const config = await import(configUrl.href)

  return {
    cwd: process.cwd(),
    ...(config.default ?? config),
  }
}
