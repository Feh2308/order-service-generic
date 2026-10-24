const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const dotenv = require("dotenv");
const { createObjectStorage, objectStorageConfigFromEnv } = require("../../server/storage");
const { analyzeSource, array, nullableDate, sqlDate, sqlTime, stableId } = require("./source-model");

dotenv.config({ path: path.resolve(__dirname, "../..", ".env") });

function argument(name, fallback = "") {
  const prefix = `--${name}=`;
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length) || fallback;
}

const mode = argument("mode", "dry-run");
const sourceKey = argument("source-key", "default");
const confirmedSha = argument("confirm-source-sha");
const outputDirectory = path.resolve(argument("output", path.join(__dirname, "output")));

function poolFromEnv() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL é obrigatória.");
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: String(process.env.DATABASE_SSL || "true").toLowerCase() === "true" ? { rejectUnauthorized: false } : undefined,
    max: 2
  });
}

async function sourceSnapshot(pool) {
  const result = await pool.query("SELECT id, data, updated_at FROM service_manager_store WHERE id=$1", [sourceKey]);
  if (result.rowCount !== 1) throw new Error(`Registro legado ${sourceKey} não encontrado.`);
  return result.rows[0];
}

function assertWriteEnabled(analysis) {
  if (String(process.env.MIGRATION_ALLOW_WRITES || "false").toLowerCase() !== "true") {
    throw new Error("Escrita bloqueada. Defina MIGRATION_ALLOW_WRITES=true somente na execução autorizada.");
  }
  if (!confirmedSha || confirmedSha !== analysis.sourceSha256) {
    throw new Error("SHA da origem não confirmado. Use --confirm-source-sha com o valor exato do dry-run.");
  }
  if (analysis.errors.length) throw new Error("A origem possui erros de validação; apply bloqueado.");
}

async function assertSchemaReady(pool) {
  const result = await pool.query("SELECT to_regclass('public.order_migration_runs') migration_runs, to_regclass('public.order_services') services, to_regclass('public.order_storage_objects') storage_objects");
  if (!result.rows[0].migration_runs || !result.rows[0].services || !result.rows[0].storage_objects) {
    throw new Error("Schema relacional não aplicado. Revise e aplique primeiro 001_create_relational_schema.sql.");
  }
}

async function transaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function insertBaseEntities(pool, db) {
  await transaction(pool, async (client) => {
    await client.query("INSERT INTO order_app_settings (key,value) VALUES ('meta',$1::jsonb) ON CONFLICT (key) DO NOTHING", [JSON.stringify(db.meta || {})]);
    for (const item of array(db.admins)) {
      await client.query("INSERT INTO order_admins (id,role,name,email,password_salt,password_hash,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING", [item.id, item.role || "admin", item.name, item.email, item.passwordSalt, item.passwordHash, nullableDate(item.createdAt), nullableDate(item.updatedAt)]);
    }
    for (const item of array(db.employees)) {
      await client.query("INSERT INTO order_employees (id,name,phone,pin_salt,pin_hash,pin_display,active,created_at,updated_at,deleted_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING", [item.id, item.name, item.phone || "", item.pinSalt, item.pinHash, item.pinDisplay || "", item.active !== false, nullableDate(item.createdAt), nullableDate(item.updatedAt), nullableDate(item.deletedAt)]);
    }
    for (const item of array(db.clients)) {
      await client.query("INSERT INTO order_clients (id,name,contact,phone,email,address,notes,active,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING", [item.id, item.name, item.contact || "", item.phone || "", item.email || "", item.address || "", item.notes || "", item.active !== false, nullableDate(item.createdAt), nullableDate(item.updatedAt)]);
    }
    for (const item of array(db.materials)) {
      await client.query("INSERT INTO order_materials (id,code,name,unit,notes,active,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING", [item.id, item.code, item.name, item.unit || "un", item.notes || "", item.active !== false, nullableDate(item.createdAt), nullableDate(item.updatedAt)]);
    }
    for (const item of array(db.teams)) {
      await client.query("INSERT INTO order_teams (id,name,leader_id,active,created_at,updated_at,deleted_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING", [item.id, item.name, item.leaderId || null, item.active !== false, nullableDate(item.createdAt), nullableDate(item.updatedAt), nullableDate(item.deletedAt)]);
      for (const [position, employeeId] of array(item.employeeIds).entries()) {
        await client.query("INSERT INTO order_team_members (team_id,employee_id,position) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [item.id, employeeId, position]);
      }
    }
  });
}

async function migrateMedia(storage, analysis) {
  const uploaded = new Map();
  for (const media of analysis.media) {
    if (!media.valid) continue;
    const upload = await storage.upload({
      key: media.objectKey,
      body: media.body,
      contentType: media.contentType,
      metadata: { serviceid: media.serviceId, kind: media.kind }
    });
    const head = await storage.head(media.objectKey);
    if (head.byteSize !== media.byteSize || (head.sha256 && head.sha256 !== media.sha256)) {
      throw new Error(`Validação HEAD falhou para ${media.objectKey}.`);
    }
    uploaded.set(`${media.serviceId}:${media.kind}`, { ...media, ...upload, ...head });
  }
  return uploaded;
}

async function insertService(pool, service, mediaByKey) {
  await transaction(pool, async (client) => {
    await client.query("INSERT INTO order_services (id,code,title,client_id,team_id,customer_snapshot,scheduled_date,scheduled_date_raw,scheduled_time,scheduled_time_raw,location,address,notes,status,workflow_status,created_by,created_at,updated_at,started_at,started_by,finished_at,finished_by,cancelled_at,sent_to_client_at,sent_to_client_by,sent_to_client_channel) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26) ON CONFLICT (id) DO NOTHING", [service.id, service.code, service.title || "", service.clientId || null, service.teamId || null, service.customer || "", sqlDate(service.date), service.date || "", sqlTime(service.time), service.time || "", service.location || "", service.address || "", service.notes || "", service.status, service.workflowStatus || "", service.createdBy || null, nullableDate(service.createdAt), nullableDate(service.updatedAt), nullableDate(service.startedAt), service.startedBy || null, nullableDate(service.finishedAt), service.finishedBy || null, nullableDate(service.cancelledAt), nullableDate(service.sentToClientAt), service.sentToClientBy || null, service.sentToClientChannel || null]);

    for (const [position, employeeId] of array(service.employeeIds).entries()) {
      await client.query("INSERT INTO order_service_assignees (service_id,employee_id,position) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [service.id, employeeId, position]);
    }
    for (const [position, item] of array(service.materials).entries()) {
      await client.query("INSERT INTO order_service_materials (id,service_id,material_id,code_snapshot,name_snapshot,unit_snapshot,quantity,notes,position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING", [item.id, service.id, item.materialId || null, item.code || "", item.name || "", item.unit || "un", Number(item.quantity || 1), item.notes || "", position]);
    }
    for (const item of array(service.serviceUpdates)) {
      await client.query("INSERT INTO order_service_updates (id,service_id,employee_id,employee_name_snapshot,description,created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING", [item.id, service.id, item.employeeId || null, item.employeeName || "", item.description, nullableDate(item.createdAt)]);
    }
    for (const [stage, location] of [["start", service.startLocation], ["finish", service.finalLocation]]) {
      if (!location) continue;
      await client.query("INSERT INTO order_service_locations (service_id,stage,type,label,latitude,longitude,accuracy,maps_url,captured_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (service_id,stage) DO NOTHING", [service.id, stage, location.type || "manual", location.label || "", location.latitude ?? null, location.longitude ?? null, location.accuracy ?? null, location.mapsUrl || "", nullableDate(location.capturedAt)]);
    }
    await client.query("INSERT INTO order_service_pricing (service_id,amount,price_status,finance_notes,priced_at,priced_by,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (service_id) DO NOTHING", [service.id, Number(service.price || 0), service.priceStatus || "PENDING", service.financeNotes || "", nullableDate(service.pricedAt), service.pricedBy || null, nullableDate(service.updatedAt)]);
    await client.query("INSERT INTO order_service_payments (id,service_id,payment_status,amount_snapshot,payment_method,payment_notes,received_at,received_by,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (service_id) DO NOTHING", [`pay_${service.id}`, service.id, service.paymentStatus || "NOT_APPLICABLE", Number(service.price || 0), service.paymentMethod || "", service.paymentNotes || "", nullableDate(service.receivedAt), service.receivedBy || null, nullableDate(service.updatedAt)]);

    if (service.reportPreference) {
      await client.query("INSERT INTO order_service_report_preferences (service_id,send_to_client,client_email,requested_at,requested_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (service_id) DO NOTHING", [service.id, Boolean(service.reportPreference.sendToClient), service.reportPreference.clientEmail || "", nullableDate(service.reportPreference.requestedAt), service.reportPreference.requestedBy || null]);
    }

    for (const kind of ["photo_before", "photo_after", "signature"]) {
      const media = mediaByKey.get(`${service.id}:${kind}`);
      if (!media) continue;
      const meta = media.metadata || {};
      await client.query("INSERT INTO order_storage_objects (id,provider,bucket,object_key,content_type,byte_size,sha256,etag,verified_at,migration_source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING", [media.storageObjectId, "s3", process.env.OBJECT_STORAGE_BUCKET, media.objectKey, media.contentType, media.byteSize, media.sha256, media.etag || null, new Date(), "service_manager_store:default"]);
      await client.query("INSERT INTO order_service_media (id,service_id,storage_object_id,kind,label,original_file_name,captured_at,captured_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (service_id,kind) DO NOTHING", [media.mediaId, service.id, media.storageObjectId, kind, meta.label || "", meta.fileName || "", nullableDate(meta.capturedAt || meta.signedAt), meta.capturedBy || service.finishedBy || null]);
      if (kind === "signature") {
        await client.query("INSERT INTO order_service_signatures (service_id,media_id,signer_name,signed_at,service_type_snapshot,service_code_snapshot) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (service_id) DO NOTHING", [service.id, media.mediaId, meta.signerName || "Cliente", nullableDate(meta.signedAt), meta.serviceType || service.title || "", meta.serviceCode || service.code || ""]);
      }
    }
  });
}

async function insertEventsAndCounter(pool, db, analysis) {
  const valid = Object.fromEntries(Object.entries(analysis.ids).map(([name, ids]) => [name, new Set(ids)]));
  await transaction(pool, async (client) => {
    for (const event of array(db.events)) {
      const d = event.details || {};
      await client.query("INSERT INTO order_events (id,type,message,details,service_id,client_id,employee_id,team_id,admin_id,created_at) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING", [event.id, event.type, event.message, JSON.stringify(d), valid.services.has(d.serviceId) ? d.serviceId : null, valid.clients.has(d.clientId) ? d.clientId : null, valid.employees.has(d.employeeId) ? d.employeeId : null, valid.teams.has(d.teamId) ? d.teamId : null, valid.admins.has(d.adminId) ? d.adminId : null, nullableDate(event.createdAt)]);
    }
    const byYear = new Map();
    for (const code of analysis.serviceCodes) {
      const match = String(code).match(/^OS-(\d{4})-(\d+)$/);
      if (match) byYear.set(Number(match[1]), Math.max(byYear.get(Number(match[1])) || 0, Number(match[2])));
    }
    for (const [year, lastNumber] of byYear) {
      await client.query("INSERT INTO order_service_code_counters (year,last_number) VALUES ($1,$2) ON CONFLICT (year) DO NOTHING", [year, lastNumber]);
    }
  });
}

async function relationalCounts(pool) {
  const result = await pool.query("SELECT (SELECT count(*) FROM order_admins)::int admins,(SELECT count(*) FROM order_employees)::int employees,(SELECT count(*) FROM order_clients)::int clients,(SELECT count(*) FROM order_materials)::int materials,(SELECT count(*) FROM order_teams)::int teams,(SELECT count(*) FROM order_services)::int services,(SELECT count(*) FROM order_events)::int events,(SELECT count(*) FROM order_service_media WHERE kind LIKE 'photo_%')::int photos,(SELECT count(*) FROM order_service_signatures)::int signatures,(SELECT count(*) FROM order_service_payments WHERE payment_status='RECEIVED')::int payments_received");
  return result.rows[0];
}

async function relationalIdentitySnapshot(pool) {
  const [admins, employees, clients, materials, teams, services, events, media, payments] = await Promise.all([
    pool.query("SELECT id FROM order_admins ORDER BY id"),
    pool.query("SELECT id FROM order_employees ORDER BY id"),
    pool.query("SELECT id FROM order_clients ORDER BY id"),
    pool.query("SELECT id FROM order_materials ORDER BY id"),
    pool.query("SELECT id FROM order_teams ORDER BY id"),
    pool.query("SELECT id,code FROM order_services ORDER BY id"),
    pool.query("SELECT id FROM order_events ORDER BY id"),
    pool.query("SELECT m.service_id,m.kind,o.sha256,o.byte_size FROM order_service_media m JOIN order_storage_objects o ON o.id=m.storage_object_id ORDER BY m.service_id,m.kind"),
    pool.query("SELECT service_id FROM order_service_payments WHERE payment_status='RECEIVED' ORDER BY service_id")
  ]);
  return {
    ids: {
      admins: admins.rows.map((row) => row.id), employees: employees.rows.map((row) => row.id),
      clients: clients.rows.map((row) => row.id), materials: materials.rows.map((row) => row.id),
      teams: teams.rows.map((row) => row.id), services: services.rows.map((row) => row.id),
      events: events.rows.map((row) => row.id)
    },
    serviceCodes: services.rows.map((row) => row.code),
    media: media.rows,
    receivedPaymentServiceIds: payments.rows.map((row) => row.service_id)
  };
}

function compareValues(source, target) {
  const sourceSet = new Set(source);
  const targetSet = new Set(target);
  return {
    missing: source.filter((value) => !targetSet.has(value)),
    unexpected: target.filter((value) => !sourceSet.has(value)),
    equal: source.length === target.length && source.every((value) => targetSet.has(value))
  };
}

async function parityReport(pool, analysis) {
  const target = await relationalIdentitySnapshot(pool);
  const ids = Object.fromEntries(Object.entries(analysis.ids).map(([name, values]) => [name, compareValues(values, target.ids[name] || [])]));
  const targetMedia = new Map(target.media.map((item) => [`${item.service_id}:${item.kind}`, `${item.sha256}:${item.byte_size}`]));
  const mediaMismatches = analysis.media.filter((item) => item.valid).filter((item) => targetMedia.get(`${item.serviceId}:${item.kind}`) !== `${item.sha256}:${item.byteSize}`).map((item) => ({ serviceId: item.serviceId, kind: item.kind }));
  const result = {
    ids,
    serviceCodes: compareValues(analysis.serviceCodes, target.serviceCodes),
    receivedPayments: compareValues(analysis.receivedPaymentServiceIds, target.receivedPaymentServiceIds),
    media: { expected: analysis.media.filter((item) => item.valid).length, found: target.media.length, mismatches: mediaMismatches }
  };
  result.ok = Object.values(ids).every((item) => item.equal) && result.serviceCodes.equal && result.receivedPayments.equal && !mediaMismatches.length && result.media.expected === result.media.found;
  return result;
}

async function writeReport(report) {
  fs.mkdirSync(outputDirectory, { recursive: true });
  const file = path.join(outputDirectory, `migration-${mode}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2), "utf8");
  return file;
}

async function main() {
  if (!["dry-run", "apply", "verify"].includes(mode)) throw new Error(`Modo inválido: ${mode}.`);
  const pool = poolFromEnv();
  try {
    const source = await sourceSnapshot(pool);
    const analysis = analyzeSource(source.data);
    const baseReport = {
      mode,
      generatedAt: new Date().toISOString(),
      source: { table: "service_manager_store", key: source.id, updatedAt: source.updated_at, sha256: analysis.sourceSha256 },
      counts: analysis.counts,
      validationErrors: analysis.errors
    };

    if (mode === "dry-run") {
      const reportFile = await writeReport(baseReport);
      console.log(JSON.stringify({ ...baseReport, reportFile }, null, 2));
      return;
    }

    await assertSchemaReady(pool);
    if (mode === "verify") {
      const target = await relationalCounts(pool);
      const countParity = {
        admins: target.admins === analysis.counts.admins,
        employees: target.employees === analysis.counts.employees,
        clients: target.clients === analysis.counts.clients,
        materials: target.materials === analysis.counts.materials,
        teams: target.teams === analysis.counts.teams,
        services: target.services === analysis.counts.services,
        events: target.events === analysis.counts.events,
        photos: target.photos === analysis.counts.photos,
        signatures: target.signatures === analysis.counts.signatures,
        paymentsReceived: target.payments_received === analysis.counts.paymentsReceived
      };
      const identityParity = await parityReport(pool, analysis);
      const report = { ...baseReport, target, countParity, identityParity };
      report.ok = Object.values(countParity).every(Boolean) && identityParity.ok && !analysis.errors.length;
      report.reportFile = await writeReport(report);
      console.log(JSON.stringify(report, null, 2));
      if (!report.ok) process.exitCode = 2;
      return;
    }

    assertWriteEnabled(analysis);
    const storageConfig = objectStorageConfigFromEnv();
    if (!storageConfig.enabled) throw new Error("OBJECT_STORAGE_ENABLED=true é obrigatório para apply.");
    const storage = createObjectStorage(storageConfig);
    const runId = stableId("migration", analysis.sourceSha256);
    await pool.query("INSERT INTO order_migration_runs (id,migration_name,source_table,source_key,source_sha256,status,phase,progress) VALUES ($1,'jsonb_to_relational_v1','service_manager_store',$2,$3,'running','base','{}'::jsonb) ON CONFLICT (migration_name,source_sha256) DO UPDATE SET status='running',updated_at=now()", [runId, sourceKey, analysis.sourceSha256]);
    await insertBaseEntities(pool, source.data);
    const media = await migrateMedia(storage, analysis);
    await pool.query("UPDATE order_migration_runs SET phase='services',progress=$2::jsonb,updated_at=now() WHERE id=$1", [runId, JSON.stringify({ mediaUploaded: media.size })]);
    let migratedServices = 0;
    for (const service of analysis.entities.services) {
      await insertService(pool, service, media);
      migratedServices += 1;
      await pool.query("UPDATE order_migration_runs SET progress=$2::jsonb,updated_at=now() WHERE id=$1", [runId, JSON.stringify({ mediaUploaded: media.size, migratedServices })]);
    }
    await insertEventsAndCounter(pool, source.data, analysis);
    const target = await relationalCounts(pool);
    const report = { ...baseReport, target };
    const reportFile = await writeReport(report);
    await pool.query("UPDATE order_migration_runs SET status='completed',phase='verified',report=$2::jsonb,completed_at=now(),updated_at=now() WHERE id=$1", [runId, JSON.stringify({ ...report, reportFile })]);
    console.log(JSON.stringify({ ...report, reportFile }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, mode, error: error.message }, null, 2));
  process.exitCode = 1;
});
