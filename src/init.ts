import type { Context } from "./get-project-context"
import path from "path"
import * as fs from "fs"
import pgstrapPackage from "../package.json"
import kyselyTypesTemplate from "./templates/kysely-types.template"
import { mkdirpSync } from "mkdirp"
import getDbClientTemplate from "./templates/get-db-client.template"

export const initPgstrap = async (ctx: Pick<Context, "cwd">) => {
  const { cwd } = ctx
  const pkg = JSON.parse(
    fs.readFileSync(path.join(cwd, "package.json")).toString()
  )

  if (!pkg.scripts) pkg.scripts = {}

  pkg.scripts["db:migrate"] = "pgstrap migrate"
  pkg.scripts["db:reset"] = "pgstrap reset"
  pkg.scripts["db:generate"] = "pgstrap generate"
  pkg.scripts["db:create-migration"] = "pgstrap create-migration"

  if (!pkg.devDependencies) pkg.devDependencies = {}
  if (!pkg.devDependencies["pgstrap"]) {
    pkg.devDependencies["pgstrap"] =
      process.env.PGSTRAP_VERSION ?? pgstrapPackage.version
  }

  if (!fs.existsSync(path.join(cwd, "pgstrap.config.js"))) {
    fs.writeFileSync(
      path.join(cwd, "pgstrap.config.js"),
      `module.exports = ${JSON.stringify(
        {
          defaultDatabase: "my_service_name",
          schemas: ["public"],
        },
        null,
        2
      )}`
    )
  }

  if (!fs.existsSync(path.join(cwd, "src", "db", "kysely-types.ts"))) {
    mkdirpSync(path.join(cwd, "src", "db"))
    fs.writeFileSync(
      path.join(cwd, "src", "db", "kysely-types.ts"),
      kyselyTypesTemplate
    )
  }

  if (!fs.existsSync(path.join(cwd, "src", "db", "get-db-client.ts"))) {
    mkdirpSync(path.join(cwd, "src", "db"))
    fs.writeFileSync(
      path.join(cwd, "src", "db", "get-db-client.ts"),
      getDbClientTemplate
    )
  }

  fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify(pkg, null, 2))
}
