import { PGlite } from "@electric-sql/pglite"
import test from "ava"

test("migration of a pglite db works", async (t) => {
  const client = new PGlite()
  console.log(await client.query("SELECT 1"))
})
