// Installs a verified Tor Expert Bundle into .test-env/ for integration tests,
// using the same installer the application uses.
//
//   npx tsx scripts/dev/install-tor.ts [version]

import { basename, join, resolve } from 'node:path';
import type { InstallStage } from '@btcortex/installation-manager';
import { fetchLatestTorVersion, installTor, readTorVersion } from '@btcortex/integration-tor';

const root = resolve(import.meta.dirname, '..', '..', '.test-env', 'tor');
const version = process.argv[2] ?? (await fetchLatestTorVersion());

let lastStage: InstallStage | undefined;
let lastTenth = -1;
const runtime = await installTor({
  version,
  runtimesDirectory: join(root, 'runtimes'),
  downloadsDirectory: join(root, 'downloads'),
  onProgress: (progress) => {
    if (progress.stage !== lastStage) {
      lastStage = progress.stage;
      console.log(`[${progress.stage}] ${progress.message}`);
    }
    if (progress.receivedBytes !== undefined && progress.totalBytes) {
      const tenth = Math.floor((progress.receivedBytes / progress.totalBytes) * 10);
      if (tenth !== lastTenth) {
        lastTenth = tenth;
        console.log(`  ${String(tenth * 10)}% of ${(progress.totalBytes / 1024 / 1024).toFixed(1)} MiB`);
      }
    }
  },
});

console.log(
  JSON.stringify(
    {
      version: runtime.version,
      tor: await readTorVersion(runtime.executable),
      executable: runtime.executable,
      archiveSha256: runtime.verification.archive.sha256,
      manifestSigners: runtime.verification.signatures.results.map(
        (result) => `${result.status}: ${result.signer ?? '?'}`,
      ),
      archiveSigners: runtime.verification.archiveSignatures?.results.map(
        (result) => `${result.status}: ${result.signer ?? '?'} ${result.createdAt ?? ''}`,
      ),
      files: runtime.verification.files?.length,
      authenticode: runtime.verification.authenticode.map((result) => `${result.status}: ${basename(result.file)}`),
    },
    null,
    2,
  ),
);
