import fs from "fs"
import path from "path"
import { pathToFileURL } from "url"
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

  const config = await import(
    pathToFileURL(path.join(process.cwd(), "pgstrap.config.js")).href
  )

  return {
    cwd: process.cwd(),
    ...(config.default ?? config),
  }
}
