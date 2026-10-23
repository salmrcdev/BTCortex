// Installs a verified Bitcoin Knots runtime into .test-env/ for regtest
// integration tests, using the same installer the application uses.
//
//   npx tsx scripts/dev/install-bitcoin-knots.ts [version]

import { basename, join, resolve } from 'node:path';
import { fetchLatestKnotsVersion, installBitcoinKnots } from '@btcortex/integration-bitcoin-knots';
import type { InstallStage } from '@btcortex/installation-manager';

const root = resolve(import.meta.dirname, '..', '..', '.test-env', 'bitcoin-knots');
const version = process.argv[2] ?? (await fetchLatestKnotsVersion());

let lastStage: InstallStage | undefined;
let lastTenth = -1;
const runtime = await installBitcoinKnots({
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
      bitcoind: runtime.bitcoind,
      archiveSha256: runtime.verification.archive.sha256,
      validSigners: runtime.verification.signatures.validSigners.map((signer) => signer.signer),
      signatureResults: runtime.verification.signatures.results.map((result) => result.status),
      authenticode: runtime.verification.authenticode.map((result) => `${result.status}: ${basename(result.file)}`),
    },
    null,
    2,
  ),
);
