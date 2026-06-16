import { test, expect } from "bun:test"
import { generateTypes } from "./generate"
import fs from "fs"
import os from "os"
import path from "path"

test("generates types from a simple schema", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-test-"))
  const schemaFile = path.join(tmpDir, "schema.sql")
  const outputFile = path.join(tmpDir, "types.ts")

  fs.writeFileSync(
    schemaFile,
    `
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      name VARCHAR(255),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    `
  )

  await generateTypes({
    schemaFiles: [schemaFile],
    outputFile,
  })

  const output = fs.readFileSync(outputFile, "utf-8")

  expect(output).toContain("export interface Users")
  expect(output).toContain("id: number")
  expect(output).toContain("email: string")
  expect(output).toContain("name: string | null")
  expect(output).toContain("created_at: Date | null")
  expect(output).toContain('export type TableName = "users"')
  expect(output).toContain("export interface Database")
  expect(output).toContain("users: Users")

  fs.rmSync(tmpDir, { recursive: true })
})

test("generates types from multiple tables", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-test-"))
  const schemaFile = path.join(tmpDir, "schema.sql")
  const outputFile = path.join(tmpDir, "types.ts")

  fs.writeFileSync(
    schemaFile,
    `
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL
    );

    CREATE TABLE posts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT
    );
    `
  )

  await generateTypes({
    schemaFiles: [schemaFile],
    outputFile,
  })

  const output = fs.readFileSync(outputFile, "utf-8")

  expect(output).toContain("export interface Users")
  expect(output).toContain("export interface Posts")
  expect(output).toContain("users: Users")
  expect(output).toContain("posts: Posts")

  fs.rmSync(tmpDir, { recursive: true })
})

test("handles multiple schema files in order", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-test-"))
  const schema1 = path.join(tmpDir, "001_users.sql")
  const schema2 = path.join(tmpDir, "002_posts.sql")
  const outputFile = path.join(tmpDir, "types.ts")

  fs.writeFileSync(
    schema1,
    `
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL
    );
    `
  )

  fs.writeFileSync(
    schema2,
    `
    CREATE TABLE posts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      title TEXT NOT NULL
    );
    `
  )

  await generateTypes({
    schemaFiles: [schema1, schema2],
    outputFile,
  })

  const output = fs.readFileSync(outputFile, "utf-8")

  expect(output).toContain("export interface Users")
  expect(output).toContain("export interface Posts")

  fs.rmSync(tmpDir, { recursive: true })
})
