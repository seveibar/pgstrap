import { PGlite } from "@electric-sql/pglite";
import * as fs from "fs";
import * as path from "path";
import { glob } from "glob";

export async function createPgliteWithMigrations(
  migrationsDir?: string
): Promise<PGlite> {
  const db = new PGlite();

  // Wait for PGlite to be ready
  await db.waitReady;

  if (migrationsDir && fs.existsSync(migrationsDir)) {
    const migrationFiles = await glob("**/*.sql", {
      cwd: migrationsDir,
      absolute: true,
    });

    // Sort migration files to apply in order
    migrationFiles.sort();

    for (const migrationFile of migrationFiles) {
      const sql = fs.readFileSync(migrationFile, "utf-8");
      try {
        await db.exec(sql);
      } catch (err: any) {
        console.warn(
          `Warning: Failed to apply migration ${path.basename(migrationFile)}: ${err.message}`
        );
      }
    }
  }

  return db;
}

export async function runQueryOnPglite(
  db: PGlite,
  query: string,
  params: any[] = []
): Promise<{ rows: any[] }> {
  const result = await db.query(query, params);
  return { rows: result.rows as any[] };
}
