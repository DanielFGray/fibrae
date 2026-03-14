/**
 * Configuration types for fibrae-cli.
 */

import type { HeadData } from "fibrae/router";

export interface FibraeConfig {
  /** Module path that exports { router, handlers, App } */
  readonly entry: string;
  /** Client hydration entry point */
  readonly client: string;
  /** Output directory (default: "dist") */
  readonly outDir?: string;
  /** Base path prefix for routes */
  readonly basePath?: string;
  /** Default page title */
  readonly title?: string;
  /** Global head tags injected into every page (fonts, analytics, meta, etc.) */
  readonly headTags?: HeadData;
}

export const defineConfig = (config: FibraeConfig): FibraeConfig => config;
