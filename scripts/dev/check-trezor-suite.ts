// Downloads the current Trezor Suite installer and checks it exactly as
// BTCortex does before installing it (detached OpenPGP signature from the
// SatoshiLabs 2021 key, Windows code signature), without running it.
//
//   npx tsx scripts/dev/check-trezor-suite.ts [--install]
//
// With --install it also runs the verified installer for the current user.

import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { checkAuthenticode, downloadFile, fetchBytes, verifyDetachedSignatures } from '@btcortex/installation-manager';
import {
  fetchLatestTrezorSuiteVersion,
  installTrezorSuite,
  SATOSHILABS_TRUSTED_KEYS,
  trezorSuiteReleaseFiles,
} from '@btcortex/integration-hardware-wallets';

const root = resolve(import.meta.dirname, '..', '..', '.test-env', 'trezor-suite');
mkdirSync(root, { recursive: true });
const version = await fetchLatestTrezorSuiteVersion();
const files = trezorSuiteReleaseFiles(version);
console.log(`Trezor Suite ${version}`);

if (process.argv.includes('--install')) {
  const record = await installTrezorSuite({
    version,
    downloadsDirectory: join(root, 'downloads'),
    recordFile: join(root, 'verification.json'),
    onProgress: (progress) => {
      if (progress.receivedBytes === undefined) console.log(`[${progress.stage}] ${progress.message}`);
    },
  });
  console.log(JSON.stringify({ installed: record.installedExecutable, authenticode: record.authenticode }, null, 2));
} else {
  const path = join(root, files.installerName);
  let lastTenth = -1;
  await downloadFile(files.installer, path, {
    onProgress: ({ receivedBytes, totalBytes }) => {
      const tenth = totalBytes ? Math.floor((receivedBytes / totalBytes) * 10) : -1;
      if (tenth !== lastTenth) {
        lastTenth = tenth;
        console.log(`  ${String(tenth * 10)}%`);
      }
    },
  });
  const { readFile } = await import('node:fs/promises');
  const signatures = await verifyDetachedSignatures(
    await readFile(path),
    new TextDecoder().decode(await fetchBytes(files.signature)),
    { keys: SATOSHILABS_TRUSTED_KEYS, threshold: 1 },
  );
  console.log(
    JSON.stringify(
      {
        signatures: signatures.results.map(
          (result) => `${result.status}: ${result.signer ?? '?'} ${result.createdAt ?? ''}`,
        ),
        authenticode: await checkAuthenticode([path]),
      },
      null,
      2,
    ),
  );
}
