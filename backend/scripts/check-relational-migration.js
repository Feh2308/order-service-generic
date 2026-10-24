const fs = require("fs");
const path = require("path");

const file = path.resolve(__dirname, "..", "sql", "relational", "001_create_relational_schema.sql");
const sql = fs.readFileSync(file, "utf8");
const withoutComments = sql.replace(/--.*$/gm, "");
const normalized = withoutComments.toUpperCase();
const forbidden = [
  ["DELETE FROM", /\bDELETE\s+FROM\b/],
  ["DROP", /\bDROP\s+(TABLE|SCHEMA|DATABASE|INDEX)\b/],
  ["TRUNCATE", /\bTRUNCATE\b/],
  ["VACUUM", /\bVACUUM\b/],
  ["ALTER TABLE SERVICE_MANAGER_STORE", /\bALTER\s+TABLE\s+SERVICE_MANAGER_STORE\b/],
  ["UPDATE SERVICE_MANAGER_STORE", /\bUPDATE\s+SERVICE_MANAGER_STORE\b/]
];
const found = forbidden.filter(([, pattern]) => pattern.test(normalized)).map(([label]) => label);

if (found.length) {
  console.error(`Migration contém operações proibidas: ${found.join(", ")}`);
  process.exit(1);
}

if (!withoutComments.includes("BEGIN;") || !withoutComments.includes("COMMIT;")) {
  console.error("Migration precisa estar delimitada por BEGIN/COMMIT.");
  process.exit(1);
}

console.log("Migration relacional validada: somente estrutura aditiva.");
