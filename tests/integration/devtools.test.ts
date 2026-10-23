import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NodeConfigDocument, NodeWithStatus } from '@btcortex/contracts';
import { DevToolsService } from '../../apps/orchestrator/src/devtools/devtools-service';
import { MemorySink, StructuredLogger } from '../../apps/orchestrator/src/logging/logger';
import { findTestBitcoind, removeTestRoot, startRegtestNode } from './support/regtest-node';
import type { RegtestNode } from './support/regtest-node';

// The developer tools against a real regtest bitcoind: blocks generated
// without a wallet and to an address, a PSBT funded by a wallet and analysed
// by the node, the wallet's own public descriptor checked and its addresses
// derived, the node's protocol features, and a probe of its RPC interface.

const bitcoind = findTestBitcoind();

describe.skipIf(!bitcoind)('developer tools (real bitcoind)', () => {
  let node: RegtestNode;
  let devtools: DevToolsService;
  let address: string;

  beforeAll(async () => {
    node = await startRegtestNode(bitcoind ?? '');
    const profile = {
      id: 'dev',
      name: 'Developer node',
      implementation: 'bitcoin-core',
      network: 'regtest',
      execution: 'external',
      runtimeVersion: null,
      dataDirectory: node.dataDirectory,
      rpcEndpoint: `http://127.0.0.1:${String(node.rpcPort)}`,
    } as unknown as NodeWithStatus['profile'];
    devtools = new DevToolsService({
      nodes: {
        get: () => ({ profile, status: { nodeId: 'dev', state: 'running', checkedAt: '2026-10-23T00:00:00.000Z' } }),
        rpc: () => node.client,
      },
      config: {
        get: () =>
          Promise.resolve({
            path: null,
            exists: false,
            editable: false,
            text: '',
            revision: 'r',
            restartRequired: false,
            commandLine: [],
          } satisfies NodeConfigDocument),
      },
      socksPort: () => undefined,
      logger: new StructuredLogger([new MemorySink()], 'debug'),
    });
    await node.client.call('createwallet', ['developer']);
    address = await node.client.call<string>('getnewaddress', [], { wallet: 'developer' });
  }, 120_000);

  afterAll(async () => {
    await node.stop();
    removeTestRoot(node.dataDirectory);
  }, 60_000);

  it('generates blocks without a wallet and to an address', async () => {
    const anyone = await devtools.mine('dev', 5, undefined);
    expect(anyone.hashes).toHaveLength(5);
    expect(anyone.height).toBe(5);
    const mine = await devtools.mine('dev', 101, address);
    expect(mine.height).toBe(106);
    const balance = await node.client.call<number>('getbalance', [], { wallet: 'developer' });
    expect(balance).toBeGreaterThan(0);
  });

  it('analyses a PSBT the wallet funded, without signing it', async () => {
    const payee = await node.client.call<string>('getnewaddress', [], { wallet: 'developer' });
    const funded = await node.client.call<{ psbt: string }>(
      'walletcreatefundedpsbt',
      [[], [{ [payee]: 1 }], 0, { fee_rate: 5 }],
      { wallet: 'developer' },
    );
    const analysis = await devtools.psbt('dev', funded.psbt);
    expect(analysis.inputs.length).toBeGreaterThan(0);
    expect(analysis.inputs.every((input) => input.hasUtxo && !input.final)).toBe(true);
    expect(analysis.outputs.some((output) => output.address === payee && output.amountSats === 100_000_000)).toBe(true);
    expect(analysis.feeSats).toBeGreaterThan(0);
    expect(analysis.next).toBe('signer');
    expect(analysis.estimatedFeeRateSatPerVb).toBeCloseTo(5, 0);
  });

  it('checks the wallet’s public descriptor and derives the same addresses as the wallet', async () => {
    const listed = await node.client.call<{ descriptors: { desc: string; internal?: boolean }[] }>(
      'listdescriptors',
      [false],
      { wallet: 'developer' },
    );
    const receive = listed.descriptors.find((entry) => entry.desc.startsWith('wpkh(') && entry.internal !== true);
    if (!receive) throw new Error('The wallet has no receiving wpkh descriptor.');
    const analysis = await devtools.descriptor('dev', receive.desc, 3);
    expect(analysis).toMatchObject({ isRange: true, isSolvable: true, addressesError: null });
    // The first receiving address the wallet handed out is the descriptor's index 0.
    expect(analysis.addresses[0]?.address).toBe(address);
    expect(analysis.addresses).toHaveLength(3);
  });

  it('reports Bitcoin Core 31’s protocol features', async () => {
    const { features, version } = await devtools.features('dev');
    expect(version).toMatch(/^3\d\./);
    const state = (id: string) => features.find((feature) => feature.id === id)?.state;
    expect(state('deployment.taproot')).toBe('on');
    expect(state('bip324')).toBe('on');
    expect(state('cluster-mempool')).toBe('on');
    expect(state('txindex')).toBe('off');
  });

  it('probes the node’s RPC interface without sending credentials', async () => {
    const result = await devtools.probe({
      kind: 'bitcoin-rpc',
      host: '127.0.0.1',
      port: node.rpcPort,
      tls: false,
      viaTor: false,
    });
    expect(result.reachable).toBe(true);
    expect(result.steps.at(-1)?.detail).toBe(
      'Bitcoin Core’s RPC interface answered and asks for credentials (none were sent).',
    );
  });
});
