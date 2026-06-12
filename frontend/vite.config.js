import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        home: resolve(__dirname, "index.html"),
        admin: resolve(__dirname, "admin/index.html"),
        funcionario: resolve(__dirname, "funcionario/index.html")
      }
    }
  },
  server: {
    port: 5173
  },
  preview: {
    port: 4173
  }
});
