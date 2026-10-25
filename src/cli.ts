#!/usr/bin/env node
import { Command } from "commander"
import { generateTypes } from "./generate-types"
import { introspectWithPglite } from "./pglite"
import { introspectWithPostgres } from "./postgres"
import fs from "node:fs"
import path from "node:path"

const program = new Command()

program
  .name("pgstrap")
  .description("Generate TypeScript types from a Postgres database")
  .version("0.0.1")

program
  .command("generate")
  .description("Generate TypeScript types from a Postgres database")
  .option("-u, --url <url>", "Postgres connection URL (postgres://...)")
  .option("-f, --file <file>", "Path to a SQL file to load into pglite")
  .option("-o, --out <out>", "Output file path", "database.types.ts")
  .option("--pglite", "Force using pglite (no Postgres server required)", false)
  .option("--postgres", "Force using a real Postgres server", false)
  .action(async (opts) => {
    try {
      let schemaSql: string | undefined

      if (opts.file) {
        const resolved = path.resolve(process.cwd(), opts.file)
        if (!fs.existsSync(resolved)) {
          console.error(`Error: SQL file not found: ${resolved}`)
          process.exit(1)
        }
        schemaSql = fs.readFileSync(resolved, "utf8")
      }

      // Default behaviour: if no Postgres URL is provided, fall back to pglite
      // so that a local Postgres server is NOT required to generate types.
      const usePglite = opts.pglite || (!opts.postgres && !opts.url)

      if (usePglite) {
        if (!schemaSql) {
          console.error(
            "Error: pglite mode requires a schema. Pass --file <schema.sql> or provide --url for a Postgres server."
          )
          process.exit(1)
        }
        const schema = await introspectWithPglite(schemaSql)
        const output = generateTypes(schema)
        fs.writeFileSync(path.resolve(process.cwd(), opts.out), output)
        console.log(`Types written to ${opts.out} (via pglite, no Postgres server needed)`)
        return
      }

      if (!opts.url) {
        console.error("Error: --url is required when using --postgres")
        process.exit(1)
      }

      const schema = await introspectWithPostgres(opts.url)
      const output = generateTypes(schema)
      fs.writeFileSync(path.resolve(process.cwd(), opts.out), output)
      console.log(`Types written to ${opts.out} (via Postgres server)`)
    } catch (err) {
      console.error("pgstrap failed:", err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

program.parse(process.argv)

if (!process.argv.slice(2).length) {
  program.outputHelp()
}
