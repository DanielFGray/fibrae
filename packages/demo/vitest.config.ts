import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// Enable globals if you want to use describe, it, expect without imports
		globals: false,
		// Set environment for DOM testing (happy-dom is faster than jsdom)
		environment: "happy-dom",
		// Include test files
		include: ["**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
		// Setup file for @effect/vitest
		setupFiles: ["./vitest.setup.ts"],
		// Exclude cypress tests
		exclude: ["**/node_modules/**", "**/cypress/**"],
	},
});
