import * as zg from "zapatos/generate";
import { Context } from "./get-project-context";
import { dumpTree } from "pg-schema-dump";
import path from "path";
import { PGlite } from "@electric-sql/pglite";

class MockClient {
  constructor(private pglite: PGlite) {}

  async query(sql: string, params?: any[]) {
    return this.pglite.query(sql, params);
  }

  async connect() {} 

  async end() {
    await this.pglite.close();
  }
}

export const generate = async ({
  schemas,
  defaultDatabase,
  dbDir,
}: Pick<Context, "schemas" | "defaultDatabase" | "dbDir">) => {
  dbDir = dbDir ?? "./src/db";

  const pglite = new PGlite({ database: ":memory:" });
  const client = new MockClient(pglite);

  await zg.generate({
    db: client as any,
    schemas: Object.fromEntries(
      schemas.map((s) => [
        s,
        {
          include: "*",
          exclude: [],
        },
      ])
    ),
    outDir: dbDir,
  });

  await dumpTree({
    targetDir: path.join(dbDir, "structure"),
    defaultDatabase,
    schemas,
  });

  await client.end();
};
