#!/usr/bin/env node
import yargs from "yargs"
import { migrate, reset, generate, createMigration, initPgstrap } from "./"
import { getProjectContext } from "./get-project-context"
;(yargs as any)
  .command("init", "initialize pgstrap", {}, async () => {
    await initPgstrap({
      cwd: process.cwd(),
    })
  })
  .command(
    "create-migration [name]",
    "create a new migration",
    (yargs: any) => {
      yargs.positional("name", {
        describe: "name of the migration file",
        type: "string",
      })
    },
    async (argv: any) => {
      const ctx = await getProjectContext()
      createMigration(argv.name as string, ctx)
    },
  )
  .command("reset", "resets the database", {}, async () => {
    await reset(await getProjectContext())

    // Reset hangs, probably due to unclosed pg connection
    process.exit(0)
  })
  .command("migrate", "migrates the database", {}, async () => {
    await migrate(await getProjectContext())
  })
  .command(
    "generate",
    "generate types and sql documentation from database",
    (yargs: any) => {
      yargs
        .option("pglite", {
          type: "boolean",
          describe: "Use in-memory PGlite instead of background Postgres daemon",
        })
        .option("postgres", {
          type: "boolean",
          default: false,
          describe: "Force external Postgres connection instead of PGlite",
        })
    },
    async (argv: any) => {
      const ctx = await getProjectContext()
      const usePglite = argv.postgres
        ? false
        : argv.pglite !== undefined
          ? Boolean(argv.pglite)
          : ctx.pglite ?? true
      await generate({ ...ctx, pglite: usePglite })
    },
  )
  .parse()
