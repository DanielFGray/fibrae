#!/usr/bin/env node
/**
 * fibrae CLI — static site generation for fibrae apps.
 *
 * Commands:
 *   fibrae build    Pre-render routes and build client bundle
 *   fibrae dev      Start Vite dev server with on-demand SSR
 *   fibrae preview  Serve the built output
 */

const [command] = process.argv.slice(2);

const commands: Record<string, () => Promise<void>> = {
  async build() {
    const { build } = await import("vite");
    await build();
  },

  async dev() {
    const { createServer } = await import("vite");
    const server = await createServer({ server: { open: true } });
    await server.listen();
    server.printUrls();
  },

  async preview() {
    const { preview } = await import("vite");
    const server = await preview();
    server.printUrls();
  },
};

const run = commands[command ?? ""];

if (!run) {
  console.log(`Usage: fibrae <command>

Commands:
  build    Pre-render routes and build client bundle
  dev      Start Vite dev server with on-demand SSR
  preview  Serve the built output`);
  process.exit(command ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
