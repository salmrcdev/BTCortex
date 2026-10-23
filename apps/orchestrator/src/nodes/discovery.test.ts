import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NodeProfile } from '@btcortex/contracts';
import { discoverLocalNodes, publicView } from './discovery';

let root: string;
let dataDirectory: string;
let image: string | undefined;

function discover(registered: NodeProfile[] = []) {
  return discoverLocalNodes(registered, {
    env: { APPDATA: join(root, 'Roaming'), LOCALAPPDATA: join(root, 'Local') },
    imageName: () => Promise.resolve(image),
  }).then((found) =>
    // Only what this test created: the real registry may point at other data directories.
    found.filter((node) => node.dataDirectory.startsWith(root)),
  );
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'btcortex-discovery-'));
  dataDirectory = join(root, 'Roaming', 'Bitcoin');
  mkdirSync(join(dataDirectory, 'blocks'), { recursive: true });
  mkdirSync(join(dataDirectory, 'testnet4', 'chainstate'), { recursive: true });
  // The mainnet node is "running": its pid file names a live process (this test).
  writeFileSync(join(dataDirectory, 'bitcoind.pid'), String(process.pid));
  writeFileSync(
    join(dataDirectory, 'bitcoin.conf'),
    'rpcport=8400\n[testnet4]\nrpcport=48400\nrpccookiefile=custom.cookie\n',
  );
  image = 'bitcoind.exe';
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('discoverLocalNodes', () => {
  it('works out the RPC address and cookie of each network from the data directory', async () => {
    const [mainnet, testnet4, ...rest] = await discover();
    expect(rest).toEqual([]);
    expect(mainnet).toMatchObject({
      network: 'mainnet',
      source: 'roaming-app-data',
      running: true,
      hasChainData: true,
      program: 'bitcoind',
      rpcServer: 'on',
      rpcEndpoint: 'http://127.0.0.1:8400',
      authentication: 'cookie',
      cookieFile: join(dataDirectory, '.cookie'),
    });
    expect(testnet4).toMatchObject({
      network: 'testnet4',
      running: false,
      hasChainData: true,
      program: 'unknown',
      rpcEndpoint: 'http://127.0.0.1:48400',
      cookieFile: join(dataDirectory, 'testnet4', 'custom.cookie'),
    });
    expect(publicView(mainnet ?? ({} as never))).not.toHaveProperty('cookieFile');
  });

  it('knows that Bitcoin Core’s window serves RPC only when it is enabled', async () => {
    image = 'bitcoin-qt.exe';
    expect((await discover())[0]?.rpcServer).toBe('off');
    writeFileSync(join(dataDirectory, 'settings.json'), JSON.stringify({ server: true }));
    expect((await discover())[0]?.rpcServer).toBe('on');
    writeFileSync(join(dataDirectory, 'settings.json'), '{}');
    writeFileSync(join(dataDirectory, 'bitcoin.conf'), 'server=1\n');
    expect((await discover())[0]?.rpcServer).toBe('on');
  });

  it('notices a password in bitcoin.conf and nodes already in BTCortex', async () => {
    writeFileSync(join(dataDirectory, 'bitcoin.conf'), 'rpcuser=alice\nrpcpassword=secret\n');
    const registered = {
      id: 'existing-1',
      network: 'mainnet',
      dataDirectory: null,
      authentication: { kind: 'cookie', cookieFile: join(dataDirectory, '.cookie') },
    } as NodeProfile;
    const [mainnet] = await discover([registered]);
    expect(mainnet).toMatchObject({ authentication: 'password-in-config', registeredAs: 'existing-1' });
    expect(JSON.stringify(mainnet)).not.toContain('secret');
  });
});
