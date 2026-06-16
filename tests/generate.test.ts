import { test, expect, beforeAll, afterAll } from "bun:test";
import { generate } from "../src/generate";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-test-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("generates types from a simple migration", async () => {
  const migrationsDir = path.join(tmpDir, "migrations1");
  fs.mkdirSync(migrationsDir, { recursive: true });

  fs.writeFileSync(
    path.join(migrationsDir, "001_init.sql"),
    `
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    `
  );

  const output = path.join(tmpDir, "db-types1.ts");

  await generate({ migrationsDir, output });

  expect(fs.existsSync(output)).toBe(true);
  const content = fs.readFileSync(output, "utf-8");

  expect(content).toContain("export interface Users");
  expect(content).toContain("email: string");
  expect(content).toContain("name?: string | null");
  expect(content).toContain("export interface DB");
  expect(content).toContain("users: Users");
});

test("generates enum types", async () => {
  const migrationsDir = path.join(tmpDir, "migrations2");
  fs.mkdirSync(migrationsDir, { recursive: true });

  fs.writeFileSync(
    path.join(migrationsDir, "001_init.sql"),
    `
    CREATE TYPE user_role AS ENUM ('admin', 'user', 'guest');

    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      role user_role NOT NULL DEFAULT 'user'
    );
    `
  );

  const output = path.join(tmpDir, "db-types2.ts");

  await generate({ migrationsDir, output });

  const content = fs.readFileSync(output, "utf-8");

  expect(content).toContain('export type UserRole = "admin" | "user" | "guest"');
  expect(content).toContain("role?: UserRole");
});

test("handles multiple migration files in order", async () => {
  const migrationsDir = path.join(tmpDir, "migrations3");
  fs.mkdirSync(migrationsDir, { recursive: true });

  fs.writeFileSync(
    path.join(migrationsDir, "001_users.sql"),
    `
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL
    );
    `
  );

  fs.writeFileSync(
    path.join(migrationsDir, "002_posts.sql"),
    `
    CREATE TABLE posts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      title TEXT NOT NULL
    );
    `
  );

  const output = path.join(tmpDir, "db-types3.ts");

  await generate({ migrationsDir, output });

  const content = fs.readFileSync(output, "utf-8");

  expect(content).toContain("export interface Users");
  expect(content).toContain("export interface Posts");
  expect(content).toContain("users: Users");
  expect(content).toContain("posts: Posts");
});

test("throws on invalid SQL in migration", async () => {
  const migrationsDir = path.join(tmpDir, "migrations4");
  fs.mkdirSync(migrationsDir, { recursive: true });

  fs.writeFileSync(
    path.join(migrationsDir, "001_bad.sql"),
    `THIS IS NOT VALID SQL;`
  );

  const output = path.join(tmpDir, "db-types4.ts");

  await expect(generate({ migrationsDir, output })).rejects.toThrow();
});
