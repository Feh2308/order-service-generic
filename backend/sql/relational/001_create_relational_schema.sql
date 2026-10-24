-- Migration aditiva e revisável. Não altera nem lê public.service_manager_store.
-- Aplicar somente após backup validado e aprovação explícita.

BEGIN;

CREATE TABLE IF NOT EXISTS order_app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_admins (
  id text PRIMARY KEY,
  role text NOT NULL DEFAULT 'admin',
  name text NOT NULL,
  email text NOT NULL,
  password_salt text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS order_admins_email_lower_uidx ON order_admins (lower(email));

CREATE TABLE IF NOT EXISTS order_employees (
  id text PRIMARY KEY,
  name text NOT NULL,
  phone text NOT NULL DEFAULT '',
  pin_salt text NOT NULL,
  pin_hash text NOT NULL,
  pin_display text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS order_employees_active_idx ON order_employees (active) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS order_clients (
  id text PRIMARY KEY,
  name text NOT NULL,
  contact text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS order_clients_name_idx ON order_clients (name);
CREATE INDEX IF NOT EXISTS order_clients_active_idx ON order_clients (active);

CREATE TABLE IF NOT EXISTS order_materials (
  id text PRIMARY KEY,
  code text NOT NULL,
  name text NOT NULL,
  unit text NOT NULL DEFAULT 'un',
  notes text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS order_materials_code_upper_uidx ON order_materials (upper(code));

CREATE TABLE IF NOT EXISTS order_teams (
  id text PRIMARY KEY,
  name text NOT NULL,
  leader_id text REFERENCES order_employees(id) ON DELETE RESTRICT,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS order_team_members (
  team_id text NOT NULL REFERENCES order_teams(id) ON DELETE CASCADE,
  employee_id text NOT NULL REFERENCES order_employees(id) ON DELETE RESTRICT,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, employee_id)
);
CREATE INDEX IF NOT EXISTS order_team_members_employee_idx ON order_team_members (employee_id, team_id);

CREATE TABLE IF NOT EXISTS order_services (
  id text PRIMARY KEY,
  code text NOT NULL UNIQUE,
  title text NOT NULL DEFAULT '',
  client_id text REFERENCES order_clients(id) ON DELETE RESTRICT,
  team_id text REFERENCES order_teams(id) ON DELETE RESTRICT,
  customer_snapshot text NOT NULL DEFAULT '',
  scheduled_date date,
  scheduled_date_raw text NOT NULL DEFAULT '',
  scheduled_time time without time zone,
  scheduled_time_raw text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  status text NOT NULL,
  workflow_status text NOT NULL DEFAULT '',
  created_by text REFERENCES order_admins(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  started_at timestamptz,
  started_by text REFERENCES order_employees(id) ON DELETE RESTRICT,
  finished_at timestamptz,
  finished_by text REFERENCES order_employees(id) ON DELETE RESTRICT,
  cancelled_at timestamptz,
  sent_to_client_at timestamptz,
  sent_to_client_by text REFERENCES order_admins(id) ON DELETE RESTRICT,
  sent_to_client_channel text
);
CREATE INDEX IF NOT EXISTS order_services_status_date_idx ON order_services (status, scheduled_date, scheduled_time);
CREATE INDEX IF NOT EXISTS order_services_workflow_updated_idx ON order_services (workflow_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS order_services_client_date_idx ON order_services (client_id, scheduled_date DESC);
CREATE INDEX IF NOT EXISTS order_services_team_date_idx ON order_services (team_id, scheduled_date DESC);
CREATE INDEX IF NOT EXISTS order_services_finished_at_idx ON order_services (finished_at DESC) WHERE finished_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS order_service_assignees (
  service_id text NOT NULL REFERENCES order_services(id) ON DELETE CASCADE,
  employee_id text NOT NULL REFERENCES order_employees(id) ON DELETE RESTRICT,
  position integer NOT NULL DEFAULT 0,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (service_id, employee_id)
);
CREATE INDEX IF NOT EXISTS order_service_assignees_employee_idx ON order_service_assignees (employee_id, service_id);

CREATE TABLE IF NOT EXISTS order_service_materials (
  id text PRIMARY KEY,
  service_id text NOT NULL REFERENCES order_services(id) ON DELETE CASCADE,
  material_id text REFERENCES order_materials(id) ON DELETE SET NULL,
  code_snapshot text NOT NULL,
  name_snapshot text NOT NULL,
  unit_snapshot text NOT NULL DEFAULT 'un',
  quantity numeric(14,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  notes text NOT NULL DEFAULT '',
  position integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS order_service_materials_service_idx ON order_service_materials (service_id, position);

CREATE TABLE IF NOT EXISTS order_service_updates (
  id text PRIMARY KEY,
  service_id text NOT NULL REFERENCES order_services(id) ON DELETE CASCADE,
  employee_id text REFERENCES order_employees(id) ON DELETE RESTRICT,
  employee_name_snapshot text NOT NULL DEFAULT '',
  description text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS order_service_updates_service_created_idx ON order_service_updates (service_id, created_at);

CREATE TABLE IF NOT EXISTS order_service_locations (
  service_id text NOT NULL REFERENCES order_services(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN ('start', 'finish')),
  type text NOT NULL CHECK (type IN ('gps', 'manual')),
  label text NOT NULL DEFAULT '',
  latitude double precision,
  longitude double precision,
  accuracy integer,
  maps_url text NOT NULL DEFAULT '',
  captured_at timestamptz NOT NULL,
  PRIMARY KEY (service_id, stage)
);

CREATE TABLE IF NOT EXISTS order_service_pricing (
  service_id text PRIMARY KEY REFERENCES order_services(id) ON DELETE CASCADE,
  amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  price_status text NOT NULL,
  finance_notes text NOT NULL DEFAULT '',
  priced_at timestamptz,
  priced_by text REFERENCES order_admins(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS order_service_pricing_status_idx ON order_service_pricing (price_status, priced_at DESC);

CREATE TABLE IF NOT EXISTS order_service_payments (
  id text PRIMARY KEY,
  service_id text NOT NULL UNIQUE REFERENCES order_services(id) ON DELETE CASCADE,
  payment_status text NOT NULL,
  amount_snapshot numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount_snapshot >= 0),
  payment_method text NOT NULL DEFAULT '',
  payment_notes text NOT NULL DEFAULT '',
  received_at timestamptz,
  received_by text REFERENCES order_admins(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS order_service_payments_status_idx ON order_service_payments (payment_status, received_at DESC);

CREATE TABLE IF NOT EXISTS order_service_report_preferences (
  service_id text PRIMARY KEY REFERENCES order_services(id) ON DELETE CASCADE,
  send_to_client boolean NOT NULL DEFAULT false,
  client_email text NOT NULL DEFAULT '',
  requested_at timestamptz NOT NULL,
  requested_by text REFERENCES order_employees(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS order_storage_objects (
  id text PRIMARY KEY,
  provider text NOT NULL,
  bucket text NOT NULL,
  object_key text NOT NULL UNIQUE,
  content_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  sha256 char(64) NOT NULL,
  etag text,
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  migration_source text
);
CREATE INDEX IF NOT EXISTS order_storage_objects_hash_size_idx ON order_storage_objects (sha256, byte_size);

CREATE TABLE IF NOT EXISTS order_service_media (
  id text PRIMARY KEY,
  service_id text NOT NULL REFERENCES order_services(id) ON DELETE CASCADE,
  storage_object_id text NOT NULL REFERENCES order_storage_objects(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('photo_before', 'photo_after', 'signature')),
  label text NOT NULL DEFAULT '',
  original_file_name text NOT NULL DEFAULT '',
  captured_at timestamptz,
  captured_by text REFERENCES order_employees(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_id, kind)
);
CREATE INDEX IF NOT EXISTS order_service_media_storage_idx ON order_service_media (storage_object_id);

CREATE TABLE IF NOT EXISTS order_service_signatures (
  service_id text PRIMARY KEY REFERENCES order_services(id) ON DELETE CASCADE,
  media_id text NOT NULL UNIQUE REFERENCES order_service_media(id) ON DELETE RESTRICT,
  signer_name text NOT NULL,
  signed_at timestamptz NOT NULL,
  service_type_snapshot text NOT NULL DEFAULT '',
  service_code_snapshot text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS order_events (
  id text PRIMARY KEY,
  type text NOT NULL,
  message text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  service_id text REFERENCES order_services(id) ON DELETE SET NULL,
  client_id text REFERENCES order_clients(id) ON DELETE SET NULL,
  employee_id text REFERENCES order_employees(id) ON DELETE SET NULL,
  team_id text REFERENCES order_teams(id) ON DELETE SET NULL,
  admin_id text REFERENCES order_admins(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS order_events_created_idx ON order_events (created_at DESC);
CREATE INDEX IF NOT EXISTS order_events_service_created_idx ON order_events (service_id, created_at DESC);
CREATE INDEX IF NOT EXISTS order_events_client_created_idx ON order_events (client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS order_service_code_counters (
  year integer PRIMARY KEY,
  last_number integer NOT NULL CHECK (last_number >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_migration_runs (
  id text PRIMARY KEY,
  migration_name text NOT NULL,
  source_table text NOT NULL,
  source_key text NOT NULL,
  source_sha256 char(64) NOT NULL,
  status text NOT NULL,
  phase text NOT NULL,
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  report jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (migration_name, source_sha256)
);

COMMIT;
