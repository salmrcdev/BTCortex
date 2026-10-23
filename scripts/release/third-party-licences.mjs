#!/usr/bin/env node
// Lists the licences of the third-party software inside BTCortex's installer
// (docs/RELEASE_PROCESS.md §6): the npm packages the interface and the
// orchestrator are built from (the lockfile's packages outside
// devDependencies), the Rust crates linked into the Windows shell (cargo
// metadata for the Windows target, normal dependencies, no procedural
// macros), the Node.js runtime inside the orchestrator executable and
// OpenPGP.js beside it, each with its licence text. Identical texts are
// printed once.
//
//   node scripts/release/third-party-licences.mjs [output file]
//
// Offline except for Node.js's own licence, fetched once per version from
// the Node.js repository and kept in .cache/licences.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const output = resolve(
  process.argv[2] ?? join(root, 'apps', 'desktop', 'src-tauri', 'resources', 'THIRD_PARTY_LICENCES.txt'),
);
const cacheDir = join(root, '.cache', 'licences');
const LICENCE_FILE = /^(licen[cs]e|copying|notice|unlicense)([-._].*)?$/i;

/** The licence files in a package folder, in a stable order. */
function licenceTexts(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => LICENCE_FILE.test(name) && statSync(join(directory, name)).isFile())
    .sort()
    .map((name) => readFileSync(join(directory, name), 'utf8').replace(/\r\n/g, '\n').trim());
}

const entries = [];
const add = (entry) => entries.push(entry);

// npm packages: everything in the lockfile that is not only a development dependency.
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
for (const [path, info] of Object.entries(lock.packages)) {
  if (!path.startsWith('node_modules/') || info.dev || info.link) continue;
  const directory = join(root, path);
  const manifest = existsSync(join(directory, 'package.json'))
    ? JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
    : {};
  const licence = typeof manifest.license === 'string' ? manifest.license : (manifest.license?.type ?? info.license);
  add({
    kind: 'npm',
    name: manifest.name ?? path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length),
    version: manifest.version ?? info.version ?? '?',
    licence: licence ?? 'not stated',
    source: typeof manifest.repository === 'string' ? manifest.repository : (manifest.repository?.url ?? ''),
    texts: licenceTexts(directory),
  });
}

// Rust crates linked into the shell on Windows.
const metadata = JSON.parse(
  execFileSync(
    'cargo',
    [
      'metadata',
      '--format-version',
      '1',
      '--offline',
      '--filter-platform',
      'x86_64-pc-windows-msvc',
      '--manifest-path',
      join(root, 'apps', 'desktop', 'src-tauri', 'Cargo.toml'),
    ],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  ),
);
const packages = new Map(metadata.packages.map((item) => [item.id, item]));
const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
const linked = new Set();
const visit = (id) => {
  if (linked.has(id)) return;
  linked.add(id);
  for (const dependency of nodes.get(id)?.deps ?? []) {
    // Normal dependencies only: build scripts and development dependencies are not shipped.
    if (dependency.dep_kinds.some((kind) => kind.kind === null)) visit(dependency.pkg);
  }
};
visit(metadata.resolve.root);
for (const id of linked) {
  const crate = packages.get(id);
  if (!crate || crate.source === null) continue; // BTCortex's own crate
  // Procedural macros run in the compiler and are not part of the program.
  if (crate.targets.every((target) => target.kind.includes('proc-macro'))) continue;
  add({
    kind: 'crate',
    name: crate.name,
    version: crate.version,
    licence: crate.license ?? (crate.license_file ? `see ${crate.license_file}` : 'not stated'),
    source: crate.repository ?? '',
    texts: licenceTexts(dirname(crate.manifest_path)),
  });
}

// The Node.js runtime the orchestrator executable is built from.
const nodeVersion = process.version;
const cachedNodeLicence = join(cacheDir, `node-${nodeVersion}.txt`);
let nodeLicence = existsSync(cachedNodeLicence) ? readFileSync(cachedNodeLicence, 'utf8') : undefined;
if (nodeLicence === undefined) {
  try {
    const response = await fetch(`https://raw.githubusercontent.com/nodejs/node/${nodeVersion}/LICENSE`);
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
    nodeLicence = await response.text();
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cachedNodeLicence, nodeLicence);
  } catch (error) {
    console.warn(
      `Node.js's licence could not be fetched (${error instanceof Error ? error.message : String(error)}); the file points to it instead.`,
    );
  }
}
add({
  kind: 'runtime',
  name: 'Node.js',
  version: nodeVersion.replace(/^v/, ''),
  licence: 'MIT, with the licences of the components it bundles',
  source: 'https://github.com/nodejs/node',
  texts: [
    nodeLicence?.replace(/\r\n/g, '\n').trim() ?? `See https://github.com/nodejs/node/blob/${nodeVersion}/LICENSE`,
  ],
});

// Identical licence texts are printed once, with the packages that carry them.
const textIds = new Map();
const textsInOrder = [];
const idOf = (text) => {
  const hash = createHash('sha256').update(text).digest('hex');
  if (!textIds.has(hash)) {
    textIds.set(hash, `T${String(textIds.size + 1)}`);
    textsInOrder.push({ id: textIds.get(hash), text, users: [] });
  }
  return textIds.get(hash);
};
const order = { runtime: 0, npm: 1, crate: 2 };
entries.sort(
  (a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
);
const lines = [];
const heading = { runtime: 'Runtime inside btcortex-orchestrator.exe', npm: 'npm packages', crate: 'Rust crates' };
let section;
for (const entry of entries) {
  if (entry.kind !== section) {
    section = entry.kind;
    lines.push('', `## ${heading[section]}`, '');
  }
  const ids = entry.texts.map(idOf);
  for (const id of ids) textsInOrder.find((item) => item.id === id)?.users.push(`${entry.name} ${entry.version}`);
  lines.push(
    `${entry.name} ${entry.version} — ${entry.licence}${entry.source ? ` — ${entry.source.replace(/^git\+/, '')}` : ''}`,
    `    licence text: ${ids.length > 0 ? ids.join(', ') : 'none in the package; the licence named above applies'}`,
  );
}

const { version } = JSON.parse(readFileSync(join(root, 'apps', 'desktop', 'package.json'), 'utf8'));
const document = [
  `Third-party software in BTCortex ${version}`,
  '',
  'BTCortex contains the software listed below, each under its own licence. OpenPGP.js',
  '(LGPL-3.0-or-later) ships as a separate file with its licence in the openpgp folder;',
  'programs BTCortex downloads later, such as Bitcoin Core or Tor, come from their',
  'publishers under their own licences and are not part of this installer.',
  `Generated by ${relative(root, fileURLToPath(import.meta.url)).replace(/\\/g, '/')} from package-lock.json and Cargo.lock.`,
  ...lines,
  '',
  '## Licence texts',
  ...textsInOrder.flatMap((item) => ['', `[${item.id}] for ${item.users.join(', ')}`, '', item.text]),
  '',
].join('\r\n');

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, document);
const count = (kind) => entries.filter((entry) => entry.kind === kind).length;
console.log(
  `Wrote ${relative(root, output)}: ${String(count('npm'))} npm packages, ${String(count('crate'))} crates, Node.js ${nodeVersion}; ${String(textsInOrder.length)} distinct licence texts, ${String(Math.round(document.length / 1024))} KiB.`,
);
