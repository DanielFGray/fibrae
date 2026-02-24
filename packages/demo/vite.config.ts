import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  define: {
    global: "globalThis",
  },
  server: {
    proxy: {
      // Proxy SSR requests to Effect HTTP server
      "/ssr": "http://localhost:3001",
      // Proxy API requests to Effect HTTP server
      "/api": "http://localhost:3001",
    },
    fs: {
      // Allow serving files from the worktree and parent directories
      allow: ["../.."],
    },
  },
  // IMPORTANT: Classic JSX transform - do NOT use jsxImportSource in tsconfig.json!
  // This manually injects the jsx/Fragment imports. Adding jsxImportSource causes:
  // "importSource cannot be set when runtime is classic"
  esbuild: {
    jsx: "transform",
    jsxDev: false,
    jsxFactory: "jsx",
    jsxFragment: "Fragment",
    jsxInject: `import { jsx, Fragment } from 'fibrae/jsx-runtime'`,
  },
  optimizeDeps: {
    exclude: [
      "@opentelemetry/sdk-trace-node",
      "@opentelemetry/sdk-node",
      "@opentelemetry/auto-instrumentations-node",
    ],
    include: ["@effect-atom/atom", "effect", "@effect/platform", "@effect/platform-browser"],
  },
  resolve: {
    alias: [
      {
        find: "@opentelemetry/sdk-trace-node",
        replacement: "@opentelemetry/sdk-trace-web",
      },
    ],
    dedupe: ["effect"],
  },
  plugins: [
    {
      name: "dev-server-logger",
      configureServer(server) {
        const logFilePath = path.resolve(
          path.join(import.meta.dirname, "..", "..", "dev-server-logs.json"),
        );
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
