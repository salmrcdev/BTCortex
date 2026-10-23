#!/usr/bin/env node
// Bundles the orchestrator into one CommonJS file and, with --sea, turns it
// into a Node.js single executable application placed where Tauri expects
// sidecar binaries (src-tauri/binaries/<name>-<target-triple>.exe). Every
// build ends with a smoke test of the artefact it produced.
//
//   node scripts/build.mjs          bundle only (dist/orchestrator.cjs)
//   node scripts/build.mjs --sea    bundle + single executable + copy to Tauri

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { smokeTest } from './smoke-test.mjs';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(appDir, 'dist');
const tauriBinariesDir = resolve(appDir, '..', 'desktop', 'src-tauri', 'binaries');
const tauriOpenPgpDir = resolve(appDir, '..', 'desktop', 'src-tauri', 'resources', 'openpgp');
const sidecarName = 'btcortex-orchestrator';
const { version } = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'));

// OpenPGP.js is LGPL-3.0-or-later, so it is not bundled into the executable:
// it ships as a file of its own, openpgp/openpgp.cjs beside the orchestrator,
// with its licence, and anyone may replace it with another build of
// OpenPGP.js. The bundle loads it from there at start-up.
// The package exports only its builds, in dist/node; the package folder is two levels up.
const openPgpPackage = resolve(dirname(createRequire(import.meta.url).resolve('openpgp')), '..', '..');
const openPgpVersion = JSON.parse(readFileSync(join(openPgpPackage, 'package.json'), 'utf8')).version;
const OPENPGP_LOADER = `
const { existsSync } = require('node:fs');
const { createRequire } = require('node:module');
const { dirname, join } = require('node:path');
let packaged = false;
try {
  packaged = require('node:sea').isSea();
} catch {}
const file = join(dirname(packaged ? process.execPath : __filename), 'openpgp', 'openpgp.cjs');
if (!existsSync(file)) {
  throw new Error('OpenPGP.js is missing: BTCortex expects it at ' + file + '. Install BTCortex again to restore it.');
}
module.exports = createRequire(file)(file);
`;
const separateOpenPgp = {
  name: 'separate-openpgp',
  setup(builder) {
    builder.onResolve({ filter: /^openpgp$/ }, () => ({ path: 'openpgp', namespace: 'separate-openpgp' }));
    builder.onLoad({ filter: /.*/, namespace: 'separate-openpgp' }, () => ({ contents: OPENPGP_LOADER, loader: 'js' }));
  },
};

/** OpenPGP.js as it ships: the library unminified, its licence, and where its source is. */
function placeOpenPgp(directory) {
  mkdirSync(directory, { recursive: true });
  copyFileSync(join(openPgpPackage, 'dist', 'node', 'openpgp.cjs'), join(directory, 'openpgp.cjs'));
  copyFileSync(join(openPgpPackage, 'LICENSE'), join(directory, 'LICENSE'));
  writeFileSync(
    join(directory, 'NOTICE.txt'),
    [
      `OpenPGP.js ${openPgpVersion}`,
      '',
      'BTCortex uses OpenPGP.js to check the signatures on the software it downloads.',
      'OpenPGP.js is licensed under the GNU Lesser General Public License, version 3',
      'or later (LICENSE in this folder). Its source code is at',
      `https://github.com/openpgpjs/openpgpjs/tree/v${openPgpVersion}`,
      '',
      'openpgp.cjs is the unmodified Node.js build from the openpgp package on npm.',
      'You may replace it with another build of OpenPGP.js; BTCortex loads whatever',
      'file is here when it starts.',
      '',
    ].join('\r\n'),
  );
}

function targetTriple() {
  if (process.env.TAURI_ENV_TARGET_TRIPLE) return process.env.TAURI_ENV_TARGET_TRIPLE;
  const output = execFileSync('rustc', ['-vV'], { encoding: 'utf8' });
  const host = /^host: (\S+)$/m.exec(output);
  if (!host) throw new Error('Could not determine the Rust host target triple from `rustc -vV`.');
  return host[1];
}

mkdirSync(distDir, { recursive: true });
const bundlePath = join(distDir, 'orchestrator.cjs');
await build({
  entryPoints: [join(appDir, 'src', 'main.ts')],
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node26',
  // Readable output keeps crash stack traces useful; size is dominated by the runtime.
  minify: false,
  sourcemap: false,
  legalComments: 'eof',
  // ES module dependencies (OpenPGP.js among them) read import.meta.url, which
  // a CommonJS bundle does not have; give them the bundle's own file URL.
  banner: { js: "const __btcortexImportMetaUrl = require('node:url').pathToFileURL(__filename).href;" },
  define: { __BTCORTEX_VERSION__: JSON.stringify(version), 'import.meta.url': '__btcortexImportMetaUrl' },
  plugins: [separateOpenPgp],
  logLevel: 'info',
});
placeOpenPgp(join(distDir, 'openpgp'));

if (process.argv.includes('--sea')) {
  const triple = targetTriple();
  const extension = triple.includes('windows') ? '.exe' : '';
  const executable = join(distDir, `${sidecarName}${extension}`);
  const seaConfig = join(distDir, 'sea-config.json');
  writeFileSync(
    seaConfig,
    JSON.stringify(
      { main: bundlePath, output: executable, disableExperimentalSEAWarning: true, useCodeCache: true },
      null,
      2,
    ),
  );
  const result = spawnSync(process.execPath, ['--build-sea', seaConfig], { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error('Building the single executable failed.');
    process.exit(result.status ?? 1);
  }
  await smokeTest([executable]);
  mkdirSync(tauriBinariesDir, { recursive: true });
  const destination = join(tauriBinariesDir, `${sidecarName}-${triple}${extension}`);
  copyFileSync(executable, destination);
  placeOpenPgp(tauriOpenPgpDir);
  console.log(`Sidecar ready: ${destination} (Node.js ${process.version}), OpenPGP.js ${openPgpVersion} beside it`);
} else {
  await smokeTest([process.execPath, bundlePath]);
}
