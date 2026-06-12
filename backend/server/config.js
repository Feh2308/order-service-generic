const path = require("path");
const ROOT_DIR = path.join(__dirname, "..");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(ROOT_DIR, ".env") });

function env(name, fallback = "") {
  const value = process.env[name];
  if (value === undefined || value === null || value === "") return fallback;
  return value;
}

function numberEnv(name, fallback) {
  const value = Number(env(name, fallback));
  return Number.isFinite(value) ? value : fallback;
}

function booleanEnv(name, fallback = false) {
  const value = String(env(name, fallback ? "true" : "false")).toLowerCase();
  return ["1", "true", "yes", "sim", "on"].includes(value);
}

function listEnv(name, fallback = "") {
  return Array.from(new Set(env(name, fallback)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)));
}

function originFromUrl(value) {
  try {
    return new URL(value).origin;
  } catch (_error) {
    return value;
  }
}

const NODE_ENV = env("NODE_ENV", "development");
const PORT = numberEnv("PORT", 3000);
const HOST = env("HOST", "0.0.0.0");
const APP_NAME = env("APP_NAME", "EG Automacoes Services");
const PUBLIC_URL = env(
  "PUBLIC_URL",
  NODE_ENV === "production" ? "" : `http://localhost:${PORT}`
);
const PUBLIC_ORIGIN = originFromUrl(PUBLIC_URL);
const FRONTEND_URL = env(
  "FRONTEND_URL",
  NODE_ENV === "production" ? "https://services.egautomacoes.com.br" : "http://localhost:5173"
);
const FRONTEND_ORIGIN = originFromUrl(FRONTEND_URL);
const DATA_DIR = path.resolve(ROOT_DIR, env("DATA_DIR", "data"));
const DATA_FILE = path.resolve(DATA_DIR, env("DATA_FILE", "db.json"));
const DB_CLIENT = env("DB_CLIENT", "json").toLowerCase();
const DATABASE_URL = env("DATABASE_URL", "");
const DATABASE_SSL = booleanEnv("DATABASE_SSL", NODE_ENV === "production" || DB_CLIENT === "postgres");
const DB_STORAGE_TABLE = env("DB_STORAGE_TABLE", "eg_services_store");
const CORS_ORIGINS = listEnv(
  "CORS_ORIGINS",
  `${PUBLIC_ORIGIN},${FRONTEND_ORIGIN},http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173,capacitor://localhost,http://localhost,https://localhost`
);
const ALLOW_LOCAL_ORIGINS = booleanEnv("ALLOW_LOCAL_ORIGINS", NODE_ENV !== "production");
const TRUST_PROXY = booleanEnv("TRUST_PROXY", NODE_ENV === "production");
const JSON_LIMIT = env("JSON_LIMIT", "10mb");
const HTTP_LOG_FORMAT = env("HTTP_LOG_FORMAT", NODE_ENV === "production" ? "combined" : "dev");
const AUTH_TOKEN_TTL_HOURS = numberEnv("AUTH_TOKEN_TTL_HOURS", 24);
const AUTH_TOKEN_TTL_MS = AUTH_TOKEN_TTL_HOURS > 0 ? AUTH_TOKEN_TTL_HOURS * 60 * 60 * 1000 : 0;

function isLocalOrigin(origin) {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch (_error) {
    return false;
  }
}

function isOriginAllowed(origin) {
  if (!origin) return true;
  if (CORS_ORIGINS.includes("*")) return true;
  if (CORS_ORIGINS.includes(origin)) return true;
  return ALLOW_LOCAL_ORIGINS && isLocalOrigin(origin);
}

module.exports = {
  ROOT_DIR,
  NODE_ENV,
  PORT,
  HOST,
  APP_NAME,
  PUBLIC_URL,
  PUBLIC_ORIGIN,
  FRONTEND_URL,
  FRONTEND_ORIGIN,
  DATA_DIR,
  DATA_FILE,
  DB_CLIENT,
  DATABASE_URL,
  DATABASE_SSL,
  DB_STORAGE_TABLE,
  CORS_ORIGINS,
  ALLOW_LOCAL_ORIGINS,
  TRUST_PROXY,
  JSON_LIMIT,
  HTTP_LOG_FORMAT,
  AUTH_TOKEN_TTL_HOURS,
  AUTH_TOKEN_TTL_MS,
  isOriginAllowed
};
