#!/usr/bin/env node
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { migrate, reset, generate, createMigration, initPgstrap } from "./"
import { getProjectContext } from "./get-project-context"
yargs(hideBin(process.argv))
  .fail(false)
  .command("init", "initialize pgstrap", {}, async () => {
    await initPgstrap({
      cwd: process.cwd(),
    })
  })
  .command(
    "create-migration [name]",
    "create a new migration",
    (yargs) => {
      yargs.positional("name", {
        describe: "name of the migration file",
        type: "string",
      })
    },
    async (argv) => {
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
    migrate(await getProjectContext())
  })
  .command(
    "generate",
    "generate types and sql documentation from database",
    (yargs) => {
      return yargs.option("pglite", { type: "boolean", default: false })
    },
    async (argv) => {
      await generate({ ...(await getProjectContext()), pglite: !!argv.pglite })
    },
  )
  .parseAsync()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
