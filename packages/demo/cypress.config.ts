import http from "node:http";
import { defineConfig } from "cypress";

export default defineConfig({
  e2e: {
    baseUrl: "http://localhost:5173",
    specPattern: "cypress/e2e/**/*.cy.{js,jsx,ts,tsx}",
    supportFile: "cypress/support/e2e.ts",
    setupNodeEvents(on, _config) {
      on("task", {
        log(message) {
          console.log(message);
          return null;
        },
        /** Read raw bytes from an SSE endpoint (Node-side, bypasses browser/proxy). */
        readSSEStream({
          url,
          waitFor = ["retry:", "event:"],
          timeoutMs = 5000,
        }: {
          url: string;
          waitFor?: string[];
          timeoutMs?: number;
        }) {
          return new Promise<string>((resolve) => {
            let data = "";
            const req = http.get(url, (res) => {
              res.on("data", (chunk: Buffer) => {
                data += chunk.toString();
                if (waitFor.every((s) => data.includes(s))) {
                  req.destroy();
                  resolve(data);
                }
              });
              res.on("end", () => resolve(data));
            });
            req.on("error", () => resolve(data));
            setTimeout(() => {
              req.destroy();
              resolve(data);
            }, timeoutMs);
          });
        },
      });
    },
  },
});
