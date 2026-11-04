import { expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import ts from "typescript"
import * as zg from "zapatos/generate"
import { initPgstrap } from "../src/init"

test("scaffolded Kysely types reject Zapatos wrappers and retain column values", async () => {
  const repo = path.resolve(import.meta.dir, "..")
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-kysely-types-"))
  try {
    fs.writeFileSync(path.join(dir, "package.json"), '{"name":"type-test"}')
    fs.symlinkSync(
      path.join(repo, "node_modules"),
      path.join(dir, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    )
    await initPgstrap({ cwd: dir })
    const rel = {
      schema: "public",
      name: "widgets",
      type: "table" as const,
      insertable: true,
    }
    const columns = [
      { column: "quantity", udtName: "int4" },
      { column: "id", udtName: "int4", hasDefault: true },
      { column: "computed", udtName: "int4", isGenerated: true },
      { column: "note", udtName: "text", isNullable: true },
      { column: "payload", udtName: "jsonb", isNullable: true },
      { column: "created", udtName: "timestamptz", isNullable: true },
      { column: "tags", udtName: "_text", isNullable: true },
      { column: "boxed", udtName: "boxed", isNullable: true },
    ].map((c) => ({
      isGenerated: false,
      isNullable: false,
      hasDefault: false,
      defaultValue: null,
      domainName: null,
      description: null,
      ...c,
    }))
    // Run the real Zapatos generator over catalog rows; no database is needed.
    const definition = await zg.definitionForRelationInSchema(
      rel,
      "public",
      {},
      {},
      zg.finaliseConfig({ db: { database: "unused" }, schemaJSDoc: false }),
      async (q) => {
        const result = { command: "SELECT", rowCount: 0, oid: 0, fields: [] }
        if (q.text.includes("information_schema.columns"))
          return { ...result, rows: columns }
        expect(q.text).toContain("pg_catalog.pg_indexes")
        return { ...result, rows: [] }
      },
    )
    fs.writeFileSync(
      path.join(dir, "schema.d.ts"),
      `declare module "zapatos/schema" {
import type * as db from "zapatos/db"
import type * as c from "zapatos/custom"
${definition}
${zg.crossTableTypesForTables([rel])}
${zg.crossSchemaTypesForAllTables([rel], "public")}
}
declare module "zapatos/custom" { export type PgBoxed = { value: string } }`,
    )
    const source = `import type { Kysely, Selectable, Insertable, Updateable } from "kysely"
import { sql } from "kysely"
import * as z from "zapatos/db"
import type { KyselySchema } from "./src/db/kysely-types"
declare const db: Kysely<KyselySchema>
declare const row: Selectable<KyselySchema["widgets"]>
db.insertInto("widgets").values({ quantity: 7 })
db.insertInto("widgets").values({ quantity: 7, note: null, payload: { value: 1, cast: "jsonb" }, created: new Date(), tags: ["a"] })
db.updateTable("widgets").set({ quantity: 8, note: "ok", payload: [1, true], created: "2020-01-01T00:00:00Z", tags: [] })
db.insertInto("widgets").values({ quantity: 7, boxed: { value: "plain custom value" } })
db.updateTable("widgets").set({ boxed: { value: "still plain" } })
const boxed: { value: string } | null = row.boxed
db.updateTable("widgets").set({ quantity: sql<number>\`9\` })
const insert: Insertable<KyselySchema["widgets"]> = { quantity: 7 }
const update: Updateable<KyselySchema["widgets"]> = {}
const quantity: number = row.quantity
const note: string | null = row.note
const computed: number = row.computed
// @ts-expect-error Zapatos parameter objects are not Kysely values
db.insertInto("widgets").values({ quantity: z.param(7) })
// @ts-expect-error the same wrapper must also be rejected for updates
db.updateTable("widgets").set({ quantity: z.param(8) })
declare const constrained: z.SQLFragment<any, number>
// @ts-expect-error constrained Zapatos fragments are not Kysely expressions
db.updateTable("widgets").set({ quantity: constrained })
// @ts-expect-error wrappers around custom values must also be rejected
db.updateTable("widgets").set({ boxed: z.param({ value: "wrapped" }) })
// @ts-expect-error direct insertable type rejects wrappers too
const invalidInsert: Insertable<KyselySchema["widgets"]> = { quantity: z.param(7) }
// @ts-expect-error direct updateable type rejects constrained fragments too
const invalidUpdate: Updateable<KyselySchema["widgets"]> = { quantity: constrained }
// @ts-expect-error unconstrained Zapatos fragments remain rejected
db.insertInto("widgets").values({ quantity: z.sql\`7\` })
// @ts-expect-error Zapatos DEFAULT remains rejected
db.updateTable("widgets").set({ id: z.Default })
// @ts-expect-error mandatory quantity remains required
db.insertInto("widgets").values({ note: "missing quantity" })
// @ts-expect-error number column still rejects strings
db.updateTable("widgets").set({ quantity: "7" })
// @ts-expect-error generated columns must remain unavailable for inserts
db.insertInto("widgets").values({ quantity: 7, computed: 1 })
// @ts-expect-error generated columns must remain unavailable for updates
db.updateTable("widgets").set({ computed: 1 })
`
    fs.writeFileSync(path.join(dir, "contract.ts"), source)
    const program = ts.createProgram(
      [path.join(dir, "contract.ts"), path.join(dir, "schema.d.ts")],
      {
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
      },
    )
    const diagnostics = ts.getPreEmitDiagnostics(program)
    expect(
      diagnostics.map((d) => ({
        message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
        position: d.file?.getLineAndCharacterOfPosition(d.start ?? 0),
      })),
    ).toEqual([])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}, 15_000)
