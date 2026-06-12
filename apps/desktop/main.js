const fs = require("fs");
const http = require("http");
const path = require("path");
const { app, BrowserWindow, shell } = require("electron");

const DEFAULT_SERVER_URL = process.env.EG_SERVER_URL || "http://localhost:3000";
const DEFAULT_ROLE = process.env.EG_APP_ROLE || "home";
const LOAD_REMOTE_UI = process.env.EG_LOAD_REMOTE === "1";
const DESKTOP_PORT = Number(process.env.EG_DESKTOP_PORT || 38652);
const PUBLIC_DIR = path.join(__dirname, "..", "..", "frontend", "dist");

let staticServer;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function appPathForRole(role) {
  if (role === "admin") return "/admin/";
  if (role === "funcionario" || role === "employee") return "/funcionario/";
  return "/";
}

function fileForRequest(urlPath) {
  const decodedPath = decodeURIComponent(urlPath.split("?")[0]);
  const normalized = path.normalize(decodedPath).replace(/^(\.\.[/\\])+/, "");
  const relativePath = normalized === "/" ? "index.html" : normalized.replace(/^[/\\]/, "");
  const candidate = path.join(PUBLIC_DIR, relativePath);
  if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
    return path.join(candidate, "index.html");
  }
  return candidate;
}

function startStaticServer() {
  if (staticServer) return Promise.resolve(staticServer.address().port);

  staticServer = http.createServer((req, res) => {
    const filePath = fileForRequest(req.url || "/");
    if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath)) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Arquivo nao encontrado.");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
  });

  return new Promise((resolve) => {
    staticServer.once("error", (error) => {
      if (error.code !== "EADDRINUSE") throw error;
      staticServer.listen(0, "127.0.0.1", () => resolve(staticServer.address().port));
    });
    staticServer.listen(DESKTOP_PORT, "127.0.0.1", () => resolve(staticServer.address().port));
  });
}

async function targetUrl() {
  const appPath = appPathForRole(DEFAULT_ROLE);
  if (LOAD_REMOTE_UI) return new URL(appPath, DEFAULT_SERVER_URL).toString();

  const port = await startStaticServer();
  const url = new URL(appPath, `http://127.0.0.1:${port}`);
  url.searchParams.set("serverDefault", DEFAULT_SERVER_URL);
  return url.toString();
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 390,
    minHeight: 640,
    title: DEFAULT_ROLE === "admin"
      ? "EG Services Admin"
      : DEFAULT_ROLE === "funcionario" || DEFAULT_ROLE === "employee"
        ? "EG Services Funcionario"
        : "EG Automacoes Services",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.loadURL(await targetUrl());
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (staticServer) staticServer.close();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
