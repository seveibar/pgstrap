import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { generate } from "./generate";

describe("generate", () => {
  let tmpDir: string;
  let migrationsDir: string;
  let outputFile: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-test-"));
    migrationsDir = path.join(tmpDir, "migrations");
    outputFile = path.join(tmpDir, "schema.ts");
    fs.mkdirSync(migrationsDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("generates types from migrations without a running PostgreSQL server", async () => {
    // Write a test migration
    fs.writeFileSync(
      path.join(migrationsDir, "001_create_users.sql"),
      `
      CREATE TYPE user_role AS ENUM ('admin', 'user', 'moderator');

      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        name TEXT,
        role user_role NOT NULL DEFAULT 'user',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE posts (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        published BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `
    );

    await generate({
      migrationsDir,
      outputFile,
    });

    expect(fs.existsSync(outputFile)).toBe(true);

    const content = fs.readFileSync(outputFile, "utf-8");

    // Check enum generation
    expect(content).toContain("export type UserRole =");
    expect(content).toContain('"admin"');
    expect(content).toContain('"user"');
    expect(content).toContain('"moderator"');

    // Check table type generation
    expect(content).toContain("export interface Users {");
    expect(content).toContain("id: number;");
    expect(content).toContain("email: string;");
    expect(content).toContain("name: string | null;");
    expect(content).toContain("role: UserRole;");

    expect(content).toContain("export interface Posts {");
    expect(content).toContain("title: string;");
    expect(content).toContain("published: boolean;");

    // Check insert type generation
    expect(content).toContain("export interface UsersInsert {");
    expect(content).toContain("export interface PostsInsert {");

    // Check update type generation
    expect(content).toContain("export interface UsersUpdate {");
    expect(content).toContain("export interface PostsUpdate {");

    // Check table names
    expect(content).toContain("export const TableNames = {");
    expect(content).toContain('"users"');
    expect(content).toContain('"posts"');
  });

  test("generates empty file with comment when no tables exist", async () => {
    const emptyMigrationsDir = path.join(tmpDir, "empty-migrations");
    const emptyOutput = path.join(tmpDir, "empty-schema.ts");
    fs.mkdirSync(emptyMigrationsDir, { recursive: true });

    await generate({
      migrationsDir: emptyMigrationsDir,
      outputFile: emptyOutput,
    });

    expect(fs.existsSync(emptyOutput)).toBe(true);
    const content = fs.readFileSync(emptyOutput, "utf-8");
    expect(content).toContain("No tables or enums found");
  });

  test("generates types from a schema file", async () => {
    const schemaFile = path.join(tmpDir, "schema.sql");
    const schemaOutput = path.join(tmpDir, "schema-from-file.ts");

    fs.writeFileSync(
      schemaFile,
      `
      CREATE TABLE products (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        price NUMERIC NOT NULL,
        description TEXT,
        in_stock BOOLEAN DEFAULT true
      );
    `
    );

    await generate({
      schemaFile,
      outputFile: schemaOutput,
    });

    expect(fs.existsSync(schemaOutput)).toBe(true);
    const content = fs.readFileSync(schemaOutput, "utf-8");
    expect(content).toContain("export interface Products {");
    expect(content).toContain("name: string;");
    expect(content).toContain("price: number;");
    expect(content).toContain("description: string | null;");
  });
});
