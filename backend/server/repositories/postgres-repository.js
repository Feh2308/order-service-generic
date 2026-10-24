const crypto = require("crypto");
const { assertRepository } = require("./repository-contract");

function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

class PostgresRepository {
  constructor({ pool, serviceMapper }) {
    if (!pool) throw new Error("Pool PostgreSQL é obrigatório.");
    this.pool = pool;
    this.serviceMapper = serviceMapper;
  }

  async transaction(work) {
    const client = await this.pool.connect();
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

  async getDashboard() {
    const [services, entities, recentEvents] = await Promise.all([
      this.pool.query("SELECT status, workflow_status, count(*)::int AS total FROM order_services GROUP BY status, workflow_status"),
      this.pool.query("SELECT (SELECT count(*) FROM order_clients)::int clients, (SELECT count(*) FROM order_materials)::int materials, (SELECT count(*) FROM order_teams WHERE deleted_at IS NULL)::int teams, (SELECT count(*) FROM order_employees WHERE active AND deleted_at IS NULL)::int active_employees"),
      this.pool.query("SELECT * FROM order_events ORDER BY created_at DESC LIMIT 12")
    ]);
    return { serviceGroups: services.rows, ...entities.rows[0], recentEvents: recentEvents.rows };
  }

  async listEmployees() { return (await this.pool.query("SELECT * FROM order_employees WHERE deleted_at IS NULL ORDER BY name")).rows; }
  async listClients() { return (await this.pool.query("SELECT * FROM order_clients ORDER BY name")).rows; }
  async listMaterials() { return (await this.pool.query("SELECT * FROM order_materials ORDER BY code")).rows; }
  async listTeams() { return (await this.pool.query("SELECT * FROM order_teams WHERE deleted_at IS NULL ORDER BY name")).rows; }

  async listServicesFor(user, filters = {}) {
    const values = [];
    const where = [];
    if (user.role !== "admin") {
      values.push(user.id);
      where.push(`EXISTS (SELECT 1 FROM order_service_assignees a WHERE a.service_id=s.id AND a.employee_id=$${values.length})`);
    }
    if (filters.status && filters.status !== "all") {
      values.push(filters.status);
      where.push(`s.status=$${values.length}`);
    }
    if (filters.clientId) {
      values.push(filters.clientId);
      where.push(`s.client_id=$${values.length}`);
    }
    const result = await this.pool.query(`SELECT s.* FROM order_services s ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY s.scheduled_date, s.scheduled_time`, values);
    return result.rows;
  }

  async createClient(payload, event = null) {
    return this.transaction(async (client) => {
      const result = await client.query("INSERT INTO order_clients (id,name,contact,phone,email,address,notes,active,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *", [payload.id || makeId("cli"), payload.name, payload.contact || "", payload.phone || "", payload.email || "", payload.address || "", payload.notes || "", payload.active !== false, payload.createdAt || new Date()]);
      if (event) await this.insertEvent(client, event);
      return result.rows[0];
    });
  }

  async updateClient(id, payload, event = null) {
    return this.transaction(async (client) => {
      const result = await client.query("UPDATE order_clients SET name=COALESCE($2,name),contact=COALESCE($3,contact),phone=COALESCE($4,phone),email=COALESCE($5,email),address=COALESCE($6,address),notes=COALESCE($7,notes),active=COALESCE($8,active),updated_at=now() WHERE id=$1 RETURNING *", [id, payload.name ?? null, payload.contact ?? null, payload.phone ?? null, payload.email ?? null, payload.address ?? null, payload.notes ?? null, payload.active ?? null]);
      if (event) await this.insertEvent(client, event);
      return result.rows[0] || null;
    });
  }

  async createService(payload, event = null) {
    return this.transaction(async (client) => {
      const result = await client.query("INSERT INTO order_services (id,code,title,client_id,team_id,customer_snapshot,scheduled_date,scheduled_date_raw,scheduled_time,scheduled_time_raw,location,address,notes,status,workflow_status,created_by,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17) RETURNING *", [payload.id || makeId("svc"), payload.code, payload.title || "", payload.clientId || null, payload.teamId || null, payload.customer || "", payload.scheduledDate || null, payload.date || "", payload.scheduledTime || null, payload.time || "", payload.location || "", payload.address || "", payload.notes || "", payload.status || "scheduled", payload.workflowStatus || "", payload.createdBy, payload.createdAt || new Date()]);
      for (const [position, employeeId] of (payload.employeeIds || []).entries()) {
        await client.query("INSERT INTO order_service_assignees (service_id,employee_id,position) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [result.rows[0].id, employeeId, position]);
      }
      if (event) await this.insertEvent(client, event);
      return result.rows[0];
    });
  }

  async updateService(id, payload, event = null) {
    return this.transaction(async (client) => {
      const result = await client.query("UPDATE order_services SET title=COALESCE($2,title),client_id=COALESCE($3,client_id),team_id=COALESCE($4,team_id),location=COALESCE($5,location),address=COALESCE($6,address),notes=COALESCE($7,notes),status=COALESCE($8,status),workflow_status=COALESCE($9,workflow_status),updated_at=now() WHERE id=$1 RETURNING *", [id, payload.title ?? null, payload.clientId ?? null, payload.teamId ?? null, payload.location ?? null, payload.address ?? null, payload.notes ?? null, payload.status ?? null, payload.workflowStatus ?? null]);
      if (event) await this.insertEvent(client, event);
      return result.rows[0] || null;
    });
  }

  async startService(id, employeeId, payload = {}, event = null) {
    return this.transitionService(id, "scheduled", "in_progress", { startedAt: payload.startedAt, employeeId, location: payload.startLocation }, event);
  }

  async finishService(id, employeeId, payload = {}, event = null) {
    return this.transitionService(id, "in_progress", "done", { finishedAt: payload.finishedAt, employeeId, location: payload.finalLocation }, event);
  }

  async transitionService(id, expectedStatus, nextStatus, data, event) {
    return this.transaction(async (client) => {
      const timestamp = data.startedAt || data.finishedAt || new Date();
      const started = nextStatus === "in_progress";
      const result = await client.query(`UPDATE order_services SET status=$3,${started ? "started_at=$4,started_by=$5" : "finished_at=$4,finished_by=$5,workflow_status='AGUARDANDO_PRECO'"},updated_at=$4 WHERE id=$1 AND status=$2 RETURNING *`, [id, expectedStatus, nextStatus, timestamp, data.employeeId]);
      if (!result.rowCount) return null;
      if (data.location) await this.upsertLocation(client, id, started ? "start" : "finish", data.location);
      if (event) await this.insertEvent(client, event);
      return result.rows[0];
    });
  }

  async priceService(id, adminId, payload = {}, event = null) {
    return this.transaction(async (client) => {
      const service = await client.query("UPDATE order_services SET workflow_status='PRECIFICADA',updated_at=now() WHERE id=$1 AND status='done' RETURNING *", [id]);
      if (!service.rowCount) return null;
      await client.query("INSERT INTO order_service_pricing (service_id,amount,price_status,finance_notes,priced_at,priced_by,updated_at) VALUES ($1,$2,'PRICED',$3,now(),$4,now()) ON CONFLICT (service_id) DO UPDATE SET amount=EXCLUDED.amount,price_status=EXCLUDED.price_status,finance_notes=EXCLUDED.finance_notes,priced_at=EXCLUDED.priced_at,priced_by=EXCLUDED.priced_by,updated_at=now()", [id, payload.price, payload.financeNotes || "", adminId]);
      if (event) await this.insertEvent(client, event);
      return service.rows[0];
    });
  }

  async receiveServicePayment(id, adminId, payload = {}, event = null) {
    return this.transaction(async (client) => {
      const pricing = await client.query("SELECT amount FROM order_service_pricing WHERE service_id=$1 AND price_status='PRICED' FOR UPDATE", [id]);
      if (!pricing.rowCount) return null;
      const paymentId = payload.id || `pay_${id}`;
      const result = await client.query("INSERT INTO order_service_payments (id,service_id,payment_status,amount_snapshot,payment_method,payment_notes,received_at,received_by,updated_at) VALUES ($1,$2,'RECEIVED',$3,$4,$5,now(),$6,now()) ON CONFLICT (service_id) DO UPDATE SET payment_status='RECEIVED',amount_snapshot=EXCLUDED.amount_snapshot,payment_method=EXCLUDED.payment_method,payment_notes=EXCLUDED.payment_notes,received_at=EXCLUDED.received_at,received_by=EXCLUDED.received_by,updated_at=now() RETURNING *", [paymentId, id, pricing.rows[0].amount, payload.paymentMethod || "", payload.paymentNotes || "", adminId]);
      if (event) await this.insertEvent(client, event);
      return result.rows[0];
    });
  }

  async addServiceUpdate(id, employeeId, payload = {}, event = null) {
    return this.transaction(async (client) => {
      const result = await client.query("INSERT INTO order_service_updates (id,service_id,employee_id,employee_name_snapshot,description,created_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *", [payload.id || makeId("upd"), id, employeeId, payload.employeeName || "", payload.description, payload.createdAt || new Date()]);
      await client.query("UPDATE order_services SET updated_at=$2 WHERE id=$1", [id, result.rows[0].created_at]);
      if (event) await this.insertEvent(client, event);
      return result.rows[0];
    });
  }

  async attachMedia(input, event = null) {
    return this.transaction(async (client) => {
      await client.query("INSERT INTO order_storage_objects (id,provider,bucket,object_key,content_type,byte_size,sha256,etag,verified_at,migration_source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (object_key) DO NOTHING", [input.storageObjectId, input.provider, input.bucket, input.objectKey, input.contentType, input.byteSize, input.sha256, input.etag || null, input.verifiedAt || null, input.migrationSource || null]);
      const media = await client.query("INSERT INTO order_service_media (id,service_id,storage_object_id,kind,label,original_file_name,captured_at,captured_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (service_id,kind) DO UPDATE SET storage_object_id=EXCLUDED.storage_object_id,label=EXCLUDED.label,original_file_name=EXCLUDED.original_file_name,captured_at=EXCLUDED.captured_at,captured_by=EXCLUDED.captured_by RETURNING *", [input.id, input.serviceId, input.storageObjectId, input.kind, input.label || "", input.originalFileName || "", input.capturedAt || null, input.capturedBy || null]);
      if (event) await this.insertEvent(client, event);
      return media.rows[0];
    });
  }

  async upsertLocation(client, serviceId, stage, location) {
    await client.query("INSERT INTO order_service_locations (service_id,stage,type,label,latitude,longitude,accuracy,maps_url,captured_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (service_id,stage) DO UPDATE SET type=EXCLUDED.type,label=EXCLUDED.label,latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,accuracy=EXCLUDED.accuracy,maps_url=EXCLUDED.maps_url,captured_at=EXCLUDED.captured_at", [serviceId, stage, location.type, location.label || "", location.latitude ?? null, location.longitude ?? null, location.accuracy ?? null, location.mapsUrl || "", location.capturedAt || new Date()]);
  }

  async insertEvent(client, event) {
    const details = event.details || {};
    return client.query("INSERT INTO order_events (id,type,message,details,service_id,client_id,employee_id,team_id,admin_id,created_at) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING", [event.id || makeId("evt"), event.type, event.message, JSON.stringify(details), details.serviceId || null, details.clientId || null, details.employeeId || null, details.teamId || null, details.adminId || null, event.createdAt || new Date()]);
  }

  async addEvent(type, message, details = {}) {
    const event = { id: makeId("evt"), type, message, details, createdAt: new Date() };
    await this.transaction((client) => this.insertEvent(client, event));
    return event;
  }
}

function createPostgresRepository(options) {
  return assertRepository(new PostgresRepository(options));
}

module.exports = { PostgresRepository, createPostgresRepository };
