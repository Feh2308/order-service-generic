const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { Pool } = require("pg");
const dotenv = require("dotenv");
const { analyzeSource } = require("./relational-migration/source-model");

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}

function safeConnection() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL ausente.");
  const url = new URL(process.env.DATABASE_URL);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("Backup interrompido: DATABASE_URL não aponta para PostgreSQL.");
  }
  return { url, display: { host: url.hostname, database: url.pathname.slice(1) } };
}

async function readSource(pool) {
  const result = await pool.query("SELECT id,data,updated_at FROM service_manager_store WHERE id=$1", ["default"]);
  if (result.rowCount !== 1) throw new Error("Registro default não encontrado em service_manager_store.");
  return result.rows[0];
}

async function main() {
  const connection = safeConnection();
  const stamp = timestamp();
  const directory = path.resolve(__dirname, "..", "..", "backups", `relational-migration-${stamp}`);
  fs.mkdirSync(directory, { recursive: false });
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: String(process.env.DATABASE_SSL || "true").toLowerCase() === "true" ? { rejectUnauthorized: false } : undefined,
    max: 1
  });
  try {
    const before = await readSource(pool);
    const dumpFile = path.join(directory, `postgres-full-${stamp}.sql`);
    const dump = spawnSync("pg_dump", [process.env.DATABASE_URL, "--format=plain", "--no-owner", "--no-privileges", `--file=${dumpFile}`], { encoding: "utf8" });
    if (dump.status !== 0) throw new Error(`pg_dump falhou: ${String(dump.stderr || "erro desconhecido").trim()}`);

    const source = await readSource(pool);
    const analysis = analyzeSource(source.data);
    const exportFile = path.join(directory, `service_manager_store-${stamp}.json`);
    const manifestFile = path.join(directory, `manifest-${stamp}.json`);
    fs.writeFileSync(exportFile, JSON.stringify({ exportedAt: new Date().toISOString(), source: connection.display, id: source.id, updatedAt: source.updated_at, data: source.data }, null, 2), { encoding: "utf8", flag: "wx" });
    fs.writeFileSync(manifestFile, JSON.stringify({
      manifestVersion: 1,
      generatedAt: new Date().toISOString(),
      source: { ...connection.display, table: "service_manager_store", key: source.id, updatedAt: source.updated_at },
      sourceDataSha256: analysis.sourceSha256,
      counts: analysis.counts,
      ids: analysis.ids,
      serviceCodes: analysis.serviceCodes,
      receivedPaymentServiceIds: analysis.receivedPaymentServiceIds,
      media: analysis.media.map(({ body, metadata, valid, ...item }) => item),
      validationErrors: analysis.errors
    }, null, 2), { encoding: "utf8", flag: "wx" });

    const after = await readSource(pool);
    const stable = String(before.updated_at) === String(after.updated_at) && String(source.updated_at) === String(after.updated_at);
    const report = { directory, stableDuringBackup: stable, sourceUpdatedAt: source.updated_at, sourceDataSha256: analysis.sourceSha256, counts: analysis.counts, validationErrors: analysis.errors };
    fs.writeFileSync(path.join(directory, `backup-report-${stamp}.json`), JSON.stringify(report, null, 2), { encoding: "utf8", flag: "wx" });
    console.log(JSON.stringify(report, null, 2));
    if (!stable || analysis.errors.length) process.exitCode = 2;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
});
