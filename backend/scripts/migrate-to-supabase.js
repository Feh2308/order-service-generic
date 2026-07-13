const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const DEFAULT_SOURCE = path.resolve(
  __dirname,
  "..",
  "..",
  "backups",
  "db-json-backup-20260620-125804.json"
);
const DEFAULT_TABLE = process.env.DB_STORAGE_TABLE || "eg_services_store";
const DEFAULT_KEY = process.env.DB_STORAGE_KEY || "default";

const WORKFLOW_STATUS = {
  WAITING_PRICE: "AGUARDANDO_PRECO",
  PRICED: "PRECIFICADA",
  SENT_TO_CLIENT: "ENVIADA_CLIENTE",
  CANCELLED: "CANCELADA"
};

function parseArgs(argv) {
  return argv.reduce((args, item) => {
    if (!item.startsWith("--")) return args;
    const [rawKey, ...rawValue] = item.slice(2).split("=");
    const key = rawKey.trim();
    const value = rawValue.length ? rawValue.join("=") : true;
    args[key] = value;
    return args;
  }, {});
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeServicePrice(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : 0;
  }

  let text = normalizeText(value).replace(/[^\d,.-]/g, "");
  if (!text) return 0;
  if (text.includes(",") && text.includes(".")) text = text.replaceAll(".", "").replace(",", ".");
  else if (text.includes(",")) text = text.replace(",", ".");

  const amount = Number(text);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : 0;
}

function sqlIdentifier(value) {
  const identifier = String(value || "").trim();
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Error(`Nome de tabela invalido para Postgres: ${identifier}`);
  }
  return `"${identifier}"`;
}

function isServicePriced(service) {
  return service.priceStatus === "PRICED" && Number(service.price) > 0;
}

function workflowStatusFor(service) {
  if (service.status === "cancelled") return WORKFLOW_STATUS.CANCELLED;
  if (service.sentToClientAt || service.workflowStatus === WORKFLOW_STATUS.SENT_TO_CLIENT) {
    return WORKFLOW_STATUS.SENT_TO_CLIENT;
  }
  if (isServicePriced(service)) return WORKFLOW_STATUS.PRICED;
  if (service.status === "done") return WORKFLOW_STATUS.WAITING_PRICE;
  return service.workflowStatus || "";
}

function ensureArray(db, key) {
  if (!Array.isArray(db[key])) db[key] = [];
}

function normalizeLoadedData(input) {
  const loaded = input && typeof input === "object" ? structuredClone(input) : {};
  if (!loaded.meta || typeof loaded.meta !== "object") loaded.meta = {};

  ["admins", "employees", "clients", "materials", "teams", "services", "events"].forEach((key) => {
    ensureArray(loaded, key);
  });

  loaded.employees.forEach((employee) => {
    if (!("pinDisplay" in employee)) employee.pinDisplay = "";
  });

  loaded.teams.forEach((team) => {
    if (!Array.isArray(team.employeeIds)) team.employeeIds = [];
    if (!("active" in team)) team.active = true;
  });

  loaded.services.forEach((service) => {
    if (!("clientId" in service)) service.clientId = null;
    if (!("teamId" in service)) service.teamId = null;
    if (!Array.isArray(service.employeeIds)) service.employeeIds = [];
    if (!Array.isArray(service.materials)) service.materials = [];

    service.price = normalizeServicePrice(service.price ?? service.serviceValue ?? service.value);
    if (!["PENDING", "PRICED"].includes(service.priceStatus)) {
      service.priceStatus = service.status === "done" && service.price > 0 ? "PRICED" : "PENDING";
    }
    if (!("financeNotes" in service)) service.financeNotes = "";
    if (!("pricedAt" in service)) {
      service.pricedAt = service.priceStatus === "PRICED" ? service.updatedAt || service.finishedAt || null : null;
    }
    if (!("pricedBy" in service)) service.pricedBy = null;
    if (!("sentToClientAt" in service)) service.sentToClientAt = null;
    if (!("sentToClientBy" in service)) service.sentToClientBy = null;
    if (!("sentToClientChannel" in service)) service.sentToClientChannel = null;
    if (!("startLocation" in service)) service.startLocation = null;
    if (!("finalLocation" in service)) service.finalLocation = null;
    if (!("clientSignature" in service)) service.clientSignature = null;
    if (!service.servicePhotos || typeof service.servicePhotos !== "object") {
      service.servicePhotos = { before: null, after: null };
    }
    if (!("before" in service.servicePhotos)) service.servicePhotos.before = null;
    if (!("after" in service.servicePhotos)) service.servicePhotos.after = null;
    if (!("reportPreference" in service)) service.reportPreference = null;
    service.workflowStatus = workflowStatusFor(service);
  });

  return loaded;
}

function duplicateIds(db, keys) {
  const result = {};
  keys.forEach((key) => {
    const seen = new Set();
    result[key] = [];
    (db[key] || []).forEach((item) => {
      if (!item?.id) return;
      if (seen.has(item.id)) result[key].push(item.id);
      seen.add(item.id);
    });
  });
  return result;
}

function countBrokenReferences(db) {
  const employees = new Set(db.employees.map((item) => item.id));
  const clients = new Set(db.clients.map((item) => item.id));
  const materials = new Set(db.materials.map((item) => item.id));
  const teams = new Set(db.teams.map((item) => item.id));

  const services = [];
  db.services.forEach((service) => {
    const problems = [];
    if (service.clientId && !clients.has(service.clientId)) problems.push("clientId");
    if (service.teamId && !teams.has(service.teamId)) problems.push("teamId");
    (service.employeeIds || []).forEach((employeeId) => {
      if (!employees.has(employeeId)) problems.push(`employeeId:${employeeId}`);
    });
    (service.materials || []).forEach((material) => {
      if (material.materialId && !materials.has(material.materialId)) {
        problems.push(`materialId:${material.materialId}`);
      }
    });
    if (problems.length) services.push({ id: service.id, code: service.code, problems });
  });

  const teamProblems = [];
  db.teams.forEach((team) => {
    const problems = [];
    if (team.leaderId && !employees.has(team.leaderId)) problems.push("leaderId");
    (team.employeeIds || []).forEach((employeeId) => {
      if (!employees.has(employeeId)) problems.push(`employeeId:${employeeId}`);
    });
    if (problems.length) teamProblems.push({ id: team.id, name: team.name, problems });
  });

  return { services, teams: teamProblems };
}

function statusCounts(services, field) {
  return services.reduce((counts, service) => {
    const key = service[field] || "vazio";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function estimatedMediaBytes(db) {
  const approxBase64Bytes = (value) => {
    const text = String(value || "");
    const comma = text.indexOf(",");
    const base64 = comma >= 0 ? text.slice(comma + 1) : text;
    return Math.floor(base64.length * 3 / 4);
  };

  return db.services.reduce((sum, service) => {
    return sum +
      approxBase64Bytes(service.clientSignature?.imageDataUrl) +
      approxBase64Bytes(service.servicePhotos?.before?.imageDataUrl) +
      approxBase64Bytes(service.servicePhotos?.after?.imageDataUrl);
  }, 0);
}

function summarize(db) {
  const keys = ["admins", "employees", "clients", "materials", "teams", "services", "events"];
  return {
    counts: Object.fromEntries(keys.map((key) => [key, db[key].length])),
    serviceStatusCounts: statusCounts(db.services, "status"),
    priceStatusCounts: statusCounts(db.services, "priceStatus"),
    workflowStatusCounts: statusCounts(db.services, "workflowStatus"),
    estimatedMediaBytes: estimatedMediaBytes(db)
  };
}

function validate(db) {
  const keys = ["admins", "employees", "clients", "materials", "teams", "services", "events"];
  const duplicates = duplicateIds(db, keys);
  const brokenReferences = countBrokenReferences(db);
  const errors = [];

  Object.entries(duplicates).forEach(([key, ids]) => {
    if (ids.length) errors.push(`IDs duplicados em ${key}: ${ids.join(", ")}`);
  });
  if (brokenReferences.services.length) {
    errors.push(`Referencias quebradas em services: ${brokenReferences.services.length}`);
  }
  if (brokenReferences.teams.length) {
    errors.push(`Referencias quebradas em teams: ${brokenReferences.teams.length}`);
  }
  if (!db.admins.length) errors.push("Nenhum admin encontrado.");

  return { errors, duplicates, brokenReferences };
}

function readBackup(source) {
  if (!fs.existsSync(source)) {
    throw new Error(`Backup nao encontrado: ${source}`);
  }
  const raw = fs.readFileSync(source, "utf8");
  return { raw, data: JSON.parse(raw), sizeBytes: Buffer.byteLength(raw, "utf8") };
}

async function withPostgres(callback) {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL nao configurada. Cole a connection string do Supabase antes de acessar o Supabase.");
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: String(process.env.DATABASE_SSL || "true").toLowerCase() === "false"
      ? undefined
      : { rejectUnauthorized: false }
  });

  try {
    return await callback(pool);
  } finally {
    await pool.end();
  }
}

async function inspectPostgres({ tableName, storageKey }) {
  const table = sqlIdentifier(tableName);
  return withPostgres(async (pool) => {
    const tableExists = await pool.query(
      `
        SELECT to_regclass($1) AS table_name
      `,
      [`public.${tableName}`]
    );

    if (!tableExists.rows[0]?.table_name) {
      return {
        tableExists: false,
        rowExists: false,
        summary: null
      };
    }

    const existing = await pool.query(`SELECT data, updated_at FROM ${table} WHERE id = $1`, [storageKey]);
    if (existing.rowCount === 0) {
      return {
        tableExists: true,
        rowExists: false,
        summary: null
      };
    }

    return {
      tableExists: true,
      rowExists: true,
      updatedAt: existing.rows[0].updated_at,
      summary: summarize(normalizeLoadedData(existing.rows[0].data))
    };
  });
}

async function applyToPostgres({ db, tableName, storageKey, replace }) {
  const table = sqlIdentifier(tableName);
  return withPostgres(async (pool) => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${table} (
        id text PRIMARY KEY,
        data jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const existing = await pool.query(`SELECT data FROM ${table} WHERE id = $1`, [storageKey]);
    if (existing.rowCount > 0) {
      const existingJson = JSON.stringify(existing.rows[0].data);
      const nextJson = JSON.stringify(db);
      if (existingJson === nextJson) {
        return {
          changed: false,
          reason: "same_data_already_exists",
          finalSummary: summarize(normalizeLoadedData(existing.rows[0].data))
        };
      }
      if (!replace) {
        throw new Error(
          `Ja existe uma linha em ${tableName}/${storageKey}. Rode novamente com --replace apenas se quiser substituir esse conteudo pelo backup.`
        );
      }
    }

    await pool.query(
      `
        INSERT INTO ${table} (id, data, updated_at)
        VALUES ($1, $2::jsonb, now())
        ON CONFLICT (id)
        DO UPDATE SET data = EXCLUDED.data, updated_at = now()
      `,
      [storageKey, JSON.stringify(db)]
    );

    const after = await pool.query(`SELECT data, updated_at FROM ${table} WHERE id = $1`, [storageKey]);
    return {
      changed: true,
      reason: existing.rowCount ? "replaced_existing_row" : "inserted_new_row",
      updatedAt: after.rows[0]?.updated_at,
      finalSummary: after.rows[0]?.data ? summarize(normalizeLoadedData(after.rows[0].data)) : null
    };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = String(args.mode || "dry-run");
  const source = path.resolve(String(args.source || DEFAULT_SOURCE));
  const tableName = String(args.table || DEFAULT_TABLE);
  const storageKey = String(args.key || DEFAULT_KEY);
  const replace = Boolean(args.replace);

  if (!["dry-run", "inspect", "apply"].includes(mode)) {
    throw new Error("Modo invalido. Use --mode=dry-run, --mode=inspect ou --mode=apply.");
  }

  sqlIdentifier(tableName);
  const backup = readBackup(source);
  const normalized = normalizeLoadedData(backup.data);
  const validation = validate(normalized);

  const report = {
    mode,
    source,
    sourceSizeBytes: backup.sizeBytes,
    tableName,
    storageKey,
    replace,
    summary: summarize(normalized),
    validation,
    willWriteToDatabase: mode === "apply",
    dataFileUntouched: path.resolve(__dirname, "..", "data", "db.json")
  };

  if (validation.errors.length) {
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 1;
    return;
  }

  if (mode === "inspect") {
    report.supabase = await inspectPostgres({ tableName, storageKey });
  }

  if (mode === "apply") {
    report.beforeApply = await inspectPostgres({ tableName, storageKey });
    report.applyResult = await applyToPostgres({
      db: normalized,
      tableName,
      storageKey,
      replace
    });
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error.message
  }, null, 2));
  process.exit(1);
});
