import test from "ava"
import fs from "fs"
import os from "os"
import child_process from "child_process"
import path from "path"
import { initPgstrap } from "../src/init"
import { getTestPostgresDatabaseFactory } from "ava-postgres"
import { Client } from "pg"

export const initialVfs = {
  "package.json": JSON.stringify({
    name: "some-package",
  }),
}

const execSync = (...args: Parameters<typeof child_process.execSync>) => {
  try {
    console.log(`> ${args[0]}`)
    return child_process.execSync(...args)
  } catch (err: any) {
    throw new Error(err.message)
  }
}

let testDir: string

test.beforeEach(() => {
  // create a temporary directory representing the filesystem
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-"))

  // create the files from the filesystem config
  for (const [filepath, contents] of Object.entries(initialVfs)) {
    const fullPath = path.join(testDir, filepath)
    fs.mkdirSync(path.dirname(fullPath), { recursive: true })
    fs.writeFileSync(fullPath, contents)
  }
})

test.afterEach(() => {
  // clean up the test directory
  fs.rm(testDir, { recursive: true }, () => {})
})

const getTestDatabase = getTestPostgresDatabaseFactory({
  postgresVersion: "14",
})

test("use pgstrap in a normal way", async (t) => {
  const { pool, connectionString } = await getTestDatabase()

  const shellOpts: Parameters<typeof child_process.execSync>[1] = {
    cwd: testDir,
    env: {
      ...process.env,
      DATABASE_URL: connectionString,
    },
    // Usually messes up output, use if debugging
    // stdio: "inherit",
  }
  console.log("test dir", testDir)

  execSync(`npm add -D file://${path.resolve(process.cwd())}`, shellOpts)

  execSync("npx pgstrap --help", shellOpts)

  await initPgstrap({ cwd: testDir })
  t.truthy(
    fs
      .readFileSync(path.join(testDir, "package.json"))
      .toString()
      .includes("db:migrate"),
  )

  execSync("npm install", shellOpts)

  execSync("npm run db:create-migration some-migration", shellOpts)

  // Read files from directory and check that the migration was created
  const migrationFiles = fs.readdirSync(path.join(testDir, "src/db/migrations"))
  const migrationFile = migrationFiles.find((file) =>
    file.includes("some-migration"),
  )
  t.truthy(migrationFile)

  // Edit the "function up() {" inside the migration file to create a table
  // called "test_table" with a column called "test_column" of type "text"
  const migrationContent = fs.readFileSync(
    path.join(testDir, `src/db/migrations/${migrationFile}`),
    "utf8",
  )
  const newMigrationContent = migrationContent.replace(
    "up(pgm: MigrationBuilder): Promise<void> {",
    `up(pgm: MigrationBuilder): Promise<void> {
pgm.createTable("test_table", {
  test_column: "text"
});`,
  )
  fs.writeFileSync(
    path.join(testDir, `src/db/migrations/${migrationFile}`),
    newMigrationContent,
  )

  // Run the migration using "npm run db:migrate"
  execSync("npm run db:migrate", shellOpts)

  // Connect to database and insert into test_table
  await pool.query("INSERT INTO test_table (test_column) VALUES ('test')")
  const { rows: rowsAfterInsert } = await pool.query("SELECT * FROM test_table")
  t.is(rowsAfterInsert.length, 1)

  await pool.end()
  // Run "npm run db:reset" and confirm that the entry in test table was
  // removed, but test_table was re-created
  execSync("npm run db:reset", shellOpts)

  const afterResetClient = new Client({ connectionString })

  await afterResetClient.connect()

  const { rows: rowsAfterReset } = await afterResetClient.query(
    "SELECT * FROM test_table",
  )
  t.is(rowsAfterReset.length, 0)

  execSync("npm run db:generate", shellOpts)

  // Check that a schema.d.ts file was created
  t.truthy(
    fs
      .readdirSync(path.join(testDir, "src/db/zapatos"))
      .includes("schema.d.ts"),
  )
  t.truthy(
    fs.existsSync(
      path.join(testDir, "src/db/structure/public/tables/test_table/table.sql"),
    ),
  )
})
