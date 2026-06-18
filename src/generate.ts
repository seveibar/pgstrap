import * as fs from "fs";
import * as path from "path";
import { PGlite } from "@electric-sql/pglite";
import { createPgliteWithMigrations, runQueryOnPglite } from "./pglite-runner";

interface ColumnInfo {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
  column_default: string | null;
}

interface EnumInfo {
  enum_name: string;
  enum_values: string[];
}

interface TableInfo {
  table_name: string;
  columns: ColumnInfo[];
}

function pgTypeToTs(
  dataType: string,
  udtName: string,
  enumNames: Set<string>
): string {
  // Check if it's a custom enum
  if (enumNames.has(udtName)) {
    return pascalCase(udtName);
  }

  switch (dataType) {
    case "integer":
    case "bigint":
    case "smallint":
    case "numeric":
    case "real":
    case "double precision":
    case "serial":
    case "bigserial":
      return "number";
    case "text":
    case "character varying":
    case "varchar":
    case "char":
    case "character":
    case "uuid":
    case "citext":
      return "string";
    case "boolean":
      return "boolean";
    case "json":
    case "jsonb":
      return "Record<string, any>";
    case "timestamp without time zone":
    case "timestamp with time zone":
    case "timestamp":
    case "date":
    case "time":
    case "time without time zone":
    case "time with time zone":
      return "Date";
    case "bytea":
      return "Buffer";
    case "ARRAY":
      return "any[]";
    case "USER-DEFINED":
      if (enumNames.has(udtName)) {
        return pascalCase(udtName);
      }
      return "any";
    default:
      return "any";
  }
}

function pascalCase(str: string): string {
  return str
    .split(/[_\s-]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
}

function camelCase(str: string): string {
  const pascal = pascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

async function getEnums(db: PGlite): Promise<EnumInfo[]> {
  const result = await runQueryOnPglite(
    db,
    `
    SELECT 
      t.typname as enum_name,
      array_agg(e.enumlabel ORDER BY e.enumsortorder) as enum_values
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
    GROUP BY t.typname
    ORDER BY t.typname
  `
  );
  return result.rows as EnumInfo[];
}

async function getTables(db: PGlite): Promise<TableInfo[]> {
  const columnsResult = await runQueryOnPglite(
    db,
    `
    SELECT 
      c.table_name,
      c.column_name,
      c.data_type,
      c.udt_name,
      c.is_nullable,
      c.column_default
    FROM information_schema.columns c
    JOIN information_schema.tables t 
      ON c.table_name = t.table_name 
      AND c.table_schema = t.table_schema
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_name, c.ordinal_position
  `
  );

  const columns = columnsResult.rows as ColumnInfo[];

  const tableMap = new Map<string, ColumnInfo[]>();
  for (const col of columns) {
    if (!tableMap.has(col.table_name)) {
      tableMap.set(col.table_name, []);
    }
    tableMap.get(col.table_name)!.push(col);
  }

  const tables: TableInfo[] = [];
  for (const [tableName, cols] of tableMap) {
    tables.push({ table_name: tableName, columns: cols });
  }

  return tables.sort((a, b) => a.table_name.localeCompare(b.table_name));
}

function generateEnumTypes(enums: EnumInfo[]): string {
  if (enums.length === 0) return "";

  const lines: string[] = ["// Enum Types", ""];

  for (const enumInfo of enums) {
    const enumName = pascalCase(enumInfo.enum_name);
    const values = enumInfo.enum_values
      .map((v: string) => `  ${JSON.stringify(v)}`)
      .join(" |\n");
    lines.push(`export type ${enumName} =`);
    lines.push(values);
    lines.push(";");
    lines.push("");
  }

  return lines.join("\n");
}

function generateTableTypes(tables: TableInfo[], enumNames: Set<string>): string {
  if (tables.length === 0) return "";

  const lines: string[] = ["// Table Types", ""];

  for (const table of tables) {
    const typeName = pascalCase(table.table_name);

    // Generate the full row type
    lines.push(`export interface ${typeName} {`);
    for (const col of table.columns) {
      const tsType = pgTypeToTs(col.data_type, col.udt_name, enumNames);
      const nullable = col.is_nullable === "YES" ? " | null" : "";
      lines.push(`  ${col.column_name}: ${tsType}${nullable};`);
    }
    lines.push("}");
    lines.push("");

    // Generate the insert type (columns with defaults or nullable are optional)
    lines.push(`export interface ${typeName}Insert {`);
    for (const col of table.columns) {
      const tsType = pgTypeToTs(col.data_type, col.udt_name, enumNames);
      const nullable = col.is_nullable === "YES" ? " | null" : "";
      const hasDefault =
        col.column_default !== null ||
        col.is_nullable === "YES";
      const optional = hasDefault ? "?" : "";
      lines.push(`  ${col.column_name}${optional}: ${tsType}${nullable};`);
    }
    lines.push("}");
    lines.push("");

    // Generate update type (all columns optional)
    lines.push(`export interface ${typeName}Update {`);
    for (const col of table.columns) {
      const tsType = pgTypeToTs(col.data_type, col.udt_name, enumNames);
      const nullable = col.is_nullable === "YES" ? " | null" : "";
      lines.push(`  ${col.column_name}?: ${tsType}${nullable};`);
    }
    lines.push("}");
    lines.push("");
  }

  return lines.join("\n");
}

function generateTableNameConstants(tables: TableInfo[]): string {
  if (tables.length === 0) return "";

  const lines: string[] = ["// Table Names", ""];
  lines.push("export const TableNames = {");
  for (const table of tables) {
    const key = camelCase(table.table_name);
    lines.push(`  ${key}: ${JSON.stringify(table.table_name)},`);
  }
  lines.push("} as const;");
  lines.push("");
  lines.push("export type TableName = typeof TableNames[keyof typeof TableNames];");
  lines.push("");

  return lines.join("\n");
}

export async function generate(options: {
  migrationsDir?: string;
  schemaFile?: string;
  outputFile: string;
  databaseUrl?: string;
}): Promise<void> {
  console.log("Generating types using PGlite (no PostgreSQL server required)...");

  let db: PGlite;

  // Create PGlite instance and apply migrations/schema
  db = await createPgliteWithMigrations(options.migrationsDir);

  // If a schema file is provided, apply it too
  if (options.schemaFile && fs.existsSync(options.schemaFile)) {
    console.log(`Applying schema from ${options.schemaFile}...`);
    const sql = fs.readFileSync(options.schemaFile, "utf-8");
    try {
      await db.exec(sql);
    } catch (err: any) {
      console.warn(`Warning: Error applying schema file: ${err.message}`);
    }
  }

  // Fetch schema information
  const enums = await getEnums(db);
  const tables = await getTables(db);

  const enumNames = new Set(enums.map((e) => e.enum_name));

  // Generate output
  const parts: string[] = [];

  parts.push("// This file is auto-generated by pgstrap. Do not edit manually.");
  parts.push(`// Generated at: ${new Date().toISOString()}`);
  parts.push("");

  if (enums.length > 0) {
    parts.push(generateEnumTypes(enums));
  }

  if (tables.length > 0) {
    parts.push(generateTableTypes(tables, enumNames));
    parts.push(generateTableNameConstants(tables));
  }

  if (tables.length === 0 && enums.length === 0) {
    parts.push("// No tables or enums found in the public schema.");
    parts.push("// Make sure your migrations directory is correct.");
    parts.push("");
  }

  const output = parts.join("\n");

  // Ensure output directory exists
  const outputDir = path.dirname(options.outputFile);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(options.outputFile, output, "utf-8");
  console.log(`✓ Types generated successfully: ${options.outputFile}`);

  if (tables.length > 0) {
    console.log(`  ${tables.length} table(s): ${tables.map((t) => t.table_name).join(", ")}`);
  }
  if (enums.length > 0) {
    console.log(`  ${enums.length} enum(s): ${enums.map((e) => e.enum_name).join(", ")}`);
  }

  // Close PGlite
  await db.close();
}
