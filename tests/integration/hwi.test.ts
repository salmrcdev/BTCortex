import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HwiClient, readHwiVersion } from '@btcortex/integration-hwi';
import { signerSetting } from '../../apps/orchestrator/src/nodes/signer-service';
import { findTestBitcoind, removeTestRoot, startRegtestNode } from './support/regtest-node';
import type { RegtestNode } from './support/regtest-node';

// The real HWI from .test-env (installed and verified by
// scripts/dev/install-hwi.ts), with no device: hwi.exe starts and answers in
// JSON, and Bitcoin Core runs it as its external signer from a quoted path
// with spaces, written the way BTCortex writes the setting. A device that
// happens to be connected is only listed: nothing is shown on it or signed.
// The signing path itself is covered by hardware-signer.test.ts with a
// stand-in that answers as HWI does.

const HWI_RUNTIMES = resolve(import.meta.dirname, '..', '..', '.test-env', 'hwi', 'runtimes');
const installed = existsSync(HWI_RUNTIMES) ? readdirSync(HWI_RUNTIMES).sort().at(-1) : undefined;
const original = installed === undefined ? undefined : join(HWI_RUNTIMES, installed, 'hwi.exe');
const bitcoind = findTestBitcoind();

describe.skipIf(!bitcoind || original === undefined || !existsSync(original))(
  'The real HWI as Bitcoin Core’s external signer (no device needed)',
  () => {
    let root: string;
    let executable: string;
    let node: RegtestNode;

    beforeAll(async () => {
      root = mkdtempSync(join(tmpdir(), 'btcortex-hwi-'));
      // Spaces in the path, as under "Program Files" or a Windows user name with a space.
      const folder = join(root, 'Program Files', 'HWI copy');
      mkdirSync(folder, { recursive: true });
      executable = join(folder, 'hwi.exe');
      copyFileSync(original ?? '', executable);
      node = await startRegtestNode(bitcoind ?? '', { settings: { signer: signerSetting(executable) } });
    }, 120_000);

    afterAll(async () => {
      await node.stop();
      removeTestRoot(root);
    }, 60_000);

    it('reports its version', async () => {
      expect(await readHwiVersion(executable)).toBe(installed);
    }, 120_000);

    it('lists devices in JSON', async () => {
      const devices = await new HwiClient({ executable }).enumerate('regtest');
      expect(Array.isArray(devices)).toBe(true);
    }, 120_000);

    it('is run by Bitcoin Core from a quoted path with spaces', async () => {
      const answer = await node.client.call<{ signers: unknown[] }>('enumeratesigners', [], { timeoutMs: 120_000 });
      expect(Array.isArray(answer.signers)).toBe(true);
    }, 150_000);
  },
);
