const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const sql = fs.readFileSync(path.resolve(__dirname, "../sql/relational/001_create_relational_schema.sql"), "utf8");
const statements = sql.replace(/--.*$/gm, "").toUpperCase();

test("migration é aditiva e não modifica a tabela legada", () => {
  for (const [label, forbidden] of [
    ["DELETE FROM", /\bDELETE\s+FROM\b/],
    ["DROP", /\bDROP\s+(TABLE|SCHEMA|DATABASE|INDEX)\b/],
    ["TRUNCATE", /\bTRUNCATE\b/],
    ["VACUUM", /\bVACUUM\b/],
    ["ALTER legado", /\bALTER\s+TABLE\s+SERVICE_MANAGER_STORE\b/],
    ["UPDATE legado", /\bUPDATE\s+SERVICE_MANAGER_STORE\b/]
  ]) {
    assert.equal(forbidden.test(statements), false, label);
  }
  assert.equal(statements.includes("CREATE TABLE IF NOT EXISTS ORDER_SERVICES"), true);
  assert.equal(statements.includes("BEGIN;"), true);
  assert.equal(statements.includes("COMMIT;"), true);
});
