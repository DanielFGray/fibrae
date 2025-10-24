import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  define: {
    global: 'globalThis',
  },
  optimizeDeps: {
    exclude: [
      '@opentelemetry/sdk-trace-node',
      '@opentelemetry/sdk-node',
      '@opentelemetry/auto-instrumentations-node'
    ]
  },
  resolve: {
    alias: {
      '@opentelemetry/sdk-trace-node': '@opentelemetry/sdk-trace-web'
    }
  },
  plugins: [
    {
      name: "dev-server-logger",
      configureServer(server) {
        const logFilePath = path.resolve(path.join(import.meta.dirname, "..", "..", "dev-server-logs.json"));
        const writeStream = fs.createWriteStream(logFilePath, { flags: "w" });
        server.middlewares.use("/__devServerLogger", (req, res) => {

          req.on("data", (chunk) => {
            const body = chunk.toString();
            writeStream.write(body);
            process.stdout.write(body);
          });

          req.on("end", () => {
            writeStream.write("\n");
            process.stdout.write("\n");

            res.writeHead(200, { "Content-Type": "text/plain" });
            res.end("ok");
          });

          req.on("error", (err) => {
            globalThis.console.error("❌ Request error:", err);
            res.writeHead(500);
            res.end("error");
          });
        });
      },
    },
  ],
});
