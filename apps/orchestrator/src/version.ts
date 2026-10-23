// Replaced at build time by esbuild (see scripts/build.mjs); falls back to a
// development marker when the sources run unbundled, for example under Vitest.
declare const __BTCORTEX_VERSION__: string | undefined;

export const ORCHESTRATOR_VERSION: string =
  typeof __BTCORTEX_VERSION__ === 'string' ? __BTCORTEX_VERSION__ : '0.0.0-development';
