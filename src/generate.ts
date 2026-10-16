import { PGlite } from "@electric-sql/pglite"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "..")
const SCHEMA_PATH = resolve(ROOT, "schema.sql")
const OUTPUT_PATH = resolve(ROOT, "src", "generated", "types.ts")

async function main() {
  if (!existsSync(SCHEMA_PATH)) {
    throw new Error(`Schema file not found at ${SCHEMA_PATH}`)
  }

  const schema = readFileSync(SCHEMA_PATH, "utf8")

  // Spin up an in-memory Postgres (WASM) — no external server required.
  const db = new PGlite()

  try {
    await db.exec(schema)

    const { rows } = await db.query<{
      table_name: string
      column_name: string
      data_type: string
      is_nullable: "YES" | "NO"
    }>(`
      SELECT
        table_name,
        column_name,
        data_type,
        is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `)

    const tables = new Map<string, Array<{ name: string; type: string; nullable: boolean }>>()

    for (const row of rows) {
      if (!tables.has(row.table_name)) {
        tables.set(row.table_name, [])
      }
      tables.get(row.table_name)!.push({
        name: row.column_name,
        type: mapPgType(row.data_type),
        nullable: row.is_nullable === "YES",
      })
    }

    const output = renderTypes(tables)

    mkdirSync(dirname(OUTPUT_PATH), { recursive: true })
    writeFileSync(OUTPUT_PATH, output, "utf8")

    console.log(`Generated types for ${tables.size} table(s) at ${OUTPUT_PATH}`)
  } finally {
    await db.close()
  }
}

function mapPgType(pgType: string): string {
  switch (pgType) {
    case "integer":
    case "smallint":
    case "bigint":
    case "numeric":
    case "real":
    case "double precision":
      return "number"
    case "boolean":
      return "boolean"
    case "json":
    case "jsonb":
      return "unknown"
    case "timestamp":
    case "timestamp with time zone":
    case "timestamp without time zone":
    case "date":
    case "time":
      return "Date"
    case "bytea":
      return "Uint8Array"
    default:
      return "string"
  }
}

function renderTypes(
  tables: Map<string, Array<{ name: string; type: string; nullable: boolean }>>,
): string {
  const lines: string[] = [
    "// AUTO-GENERATED — do not edit by hand.",
    "// Run `bun run db:generate` to regenerate.",
    "",
  ]

  for (const [tableName, columns] of tables) {
    const typeName = toPascalCase(tableName)
    lines.push(`export interface ${typeName} {`)
    for (const col of columns) {
      const optional = col.nullable ? "?" : ""
      lines.push(`  ${col.name}${optional}: ${col.type}`)
    }
    lines.push("}")
    lines.push("")
  }

  return lines.join("\n")
}

function toPascalCase(input: string): string {
  return input
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
