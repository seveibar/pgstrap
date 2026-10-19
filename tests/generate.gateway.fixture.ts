import { expect, mock, test } from "bun:test"
import { Client } from "pg"
import * as zapatos from "zapatos/generate"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const generateTypes = zapatos.generate
let inspectGateway: (connectionString: string) => Promise<void> = async () => {}

mock.module("zapatos/generate", () => ({
  generate: async (options: Parameters<typeof generateTypes>[0]) => {
    await inspectGateway(options.db.connectionString!)
    await generateTypes(options)
  },
}))

const { generate } = await import("../src/generate")

test("gateway preserves PostgreSQL errors and supports subsequent queries", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-gateway-"))
  const migrationsDir = path.join(tmp, "migrations")
  fs.mkdirSync(migrationsDir)
  fs.writeFileSync(
    path.join(migrationsDir, "001_probe.js"),
    "exports.up = (pgm) => pgm.createTable('probe', { id: 'id' })",
  )

  inspectGateway = async (connectionString) => {
    const client = new Client({
      connectionString,
      connectionTimeoutMillis: 1000,
      query_timeout: 1000,
    })
    try {
      await client.connect()
      await expect(
        client.query("SELECT * FROM deliberately_missing_gateway_table"),
      ).rejects.toMatchObject({
        code: "42P01",
        message: 'relation "deliberately_missing_gateway_table" does not exist',
      })
      expect((await client.query("SELECT 42 AS answer")).rows).toEqual([
        { answer: 42 },
      ])

      // Parameters exercise the extended query protocol and its Sync recovery.
      await expect(
        client.query("SELECT 1 / $1::integer", [0]),
      ).rejects.toMatchObject({
        code: "22012",
        message: "division by zero",
      })
      expect(
        (await client.query("SELECT $1::integer AS answer", [43])).rows,
      ).toEqual([{ answer: 43 }])
    } finally {
      await client.end()
    }
  }

  try {
    await generate({
      schemas: ["public"],
      defaultDatabase: "postgres",
      dbDir: path.join(tmp, "db"),
      migrationsDir,
      pglite: true,
    })
    expect(fs.existsSync(path.join(tmp, "db/zapatos/schema.d.ts"))).toBe(true)
    expect(
      fs.existsSync(
        path.join(tmp, "db/structure/public/tables/probe/table.sql"),
      ),
    ).toBe(true)
  } finally {
    inspectGateway = async () => {}
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
