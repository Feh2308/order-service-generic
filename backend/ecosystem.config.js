module.exports = {
  apps: [
    {
      name: "service-manager",
      script: "server/server.js",
      cwd: __dirname,
      exec_mode: "fork",
      instances: 1,
      watch: false,
      time: true,
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "production",
        TZ: "America/Sao_Paulo",
        APP_NAME: "Order Service",
        HOST: "0.0.0.0",
        PORT: "3000",
        PUBLIC_URL: "https://sua-api.exemplo.com",
        FRONTEND_URL: "https://seu-dominio.exemplo.com",
        TRUST_PROXY: "true",
        HTTP_LOG_FORMAT: "combined",
        JSON_LIMIT: "10mb",
        AUTH_TOKEN_TTL_HOURS: "24",
        DATA_DIR: "./data",
        DATA_FILE: "db.json",
        DB_CLIENT: "json",
        DATABASE_URL: "",
        CORS_ORIGINS: "https://seu-dominio.exemplo.com,https://sua-api.exemplo.com,capacitor://localhost,http://localhost,https://localhost,http://127.0.0.1",
        ALLOW_LOCAL_ORIGINS: "false"
      }
    }
  ]
};
