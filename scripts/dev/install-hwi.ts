// Installs a verified HWI into .test-env/ for integration tests,
// using the same installer the application uses.
//
//   npx tsx scripts/dev/install-hwi.ts [version]

import { basename, join, resolve } from 'node:path';
import type { InstallStage } from '@btcortex/installation-manager';
import { fetchLatestHwiVersion, installHwi, readHwiVersion } from '@btcortex/integration-hwi';

const root = resolve(import.meta.dirname, '..', '..', '.test-env', 'hwi');
const version = process.argv[2] ?? (await fetchLatestHwiVersion());

let lastStage: InstallStage | undefined;
let lastTenth = -1;
const runtime = await installHwi({
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
      hwi: await readHwiVersion(runtime.executable),
      executable: runtime.executable,
      archiveSha256: runtime.verification.archive.sha256,
      manifestSigners: runtime.verification.signatures.results.map(
        (result) => `${result.status}: ${result.signer ?? '?'}`,
      ),
      files: runtime.verification.files?.length,
      authenticode: runtime.verification.authenticode.map((result) => `${result.status}: ${basename(result.file)}`),
    },
    null,
    2,
  ),
);
