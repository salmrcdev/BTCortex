import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  activeNetworkMarkers,
  planSparrowConnection,
  readSparrowConfig,
  setAsideNetworkMarkers,
  sparrowConfigPath,
  sparrowNetworkArgument,
  writeSparrowConfig,
} from './config';

const target = {
  rpcEndpoint: 'http://127.0.0.1:8332',
  dataDirectory: 'C:\\Users\\Dev\\AppData\\Local\\BTCortex\\nodes\\mainnet-1',
};

const directories: string[] = [];
function home(): string {
  const directory = mkdtempSync(join(tmpdir(), 'btcortex-sparrow-'));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('planSparrowConnection', () => {
  it('writes exactly the cookie-based Bitcoin Core connection on first use', () => {
    const plan = planSparrowConnection(undefined, target);
    expect(plan.changes).toEqual({
      mode: 'ONLINE',
      serverType: 'BITCOIN_CORE',
      coreServer: 'http://127.0.0.1:8332',
      coreAuthType: 'COOKIE',
      coreDataDir: target.dataDirectory,
      useLegacyCoreWallet: false,
    });
    expect(plan.notes).toEqual(['first-use']);
    expect(plan.conflict).toBeUndefined();
  });

  it('recognises an existing identical configuration', () => {
    const existing = {
      ...planSparrowConnection(undefined, target).changes,
      coreServer: 'http://127.0.0.1:8332|My node',
    };
    expect(
      planSparrowConnection(existing, { ...target, dataDirectory: `${target.dataDirectory}\\` }).alreadyConfigured,
    ).toBe(true);
  });

  it('reports a server the user chose instead of replacing it silently', () => {
    expect(
      planSparrowConnection(
        { serverType: 'ELECTRUM_SERVER', electrumServer: 'ssl://electrum.example:50002|Home' },
        target,
      ).conflict,
    ).toEqual({
      serverType: 'ELECTRUM_SERVER',
      server: 'ssl://electrum.example:50002',
    });
    expect(
      planSparrowConnection({ serverType: 'BITCOIN_CORE', coreServer: 'http://192.168.1.20:8332' }, target).conflict,
    ).toEqual({
      serverType: 'BITCOIN_CORE',
      server: 'http://192.168.1.20:8332',
    });
    expect(
      planSparrowConnection(
        { serverType: 'BITCOIN_CORE', coreServer: target.rpcEndpoint, coreDataDir: target.dataDirectory },
        target,
      ).conflict,
    ).toBeUndefined();
  });

  it('points Sparrow at the Electrum server, naming it, and drops an earlier server’s certificate', () => {
    const electrum = { electrumUrl: 'tcp://127.0.0.1:50001' };
    expect(planSparrowConnection(undefined, electrum)).toEqual({
      changes: { mode: 'ONLINE', serverType: 'ELECTRUM_SERVER', electrumServer: 'tcp://127.0.0.1:50001|BTCortex' },
      removals: [],
      alreadyConfigured: false,
      conflict: undefined,
      notes: ['first-use'],
    });
    // The node's own Bitcoin Core connection is another server the user chose.
    const onNode = planSparrowConnection(
      { mode: 'ONLINE', serverType: 'BITCOIN_CORE', coreServer: target.rpcEndpoint, coreDataDir: target.dataDirectory },
      electrum,
    );
    expect(onNode.conflict).toEqual({ serverType: 'BITCOIN_CORE', server: target.rpcEndpoint });
    const earlier = planSparrowConnection(
      {
        mode: 'ONLINE',
        serverType: 'ELECTRUM_SERVER',
        electrumServer: 'tcp://127.0.0.1:50001|BTCortex',
        electrumServerCert: 'C:\\certs\\old.crt',
      },
      electrum,
    );
    expect(earlier).toMatchObject({ alreadyConfigured: false, removals: ['electrumServerCert'], conflict: undefined });
    expect(
      planSparrowConnection(
        { mode: 'ONLINE', serverType: 'ELECTRUM_SERVER', electrumServer: 'tcp://127.0.0.1:50001|My server' },
        electrum,
      ).alreadyConfigured,
    ).toBe(true);
  });

  it('notes a configured proxy', () => {
    expect(planSparrowConnection({ useProxy: true, proxyServer: '127.0.0.1:9050' }, target).notes).toContain(
      'proxy-enabled',
    );
  });
});

describe('Sparrow configuration files', () => {
  it('removes only the keys asked for', async () => {
    const path = join(home(), 'config');
    const existing = { serverType: 'ELECTRUM_SERVER', electrumServerCert: 'C:\\old.crt', wallets: ['a'] };
    writeFileSync(path, JSON.stringify(existing));
    await writeSparrowConfig(path, existing, { electrumServer: 'tcp://127.0.0.1:50001|BTCortex' }, undefined, [
      'electrumServerCert',
    ]);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      serverType: 'ELECTRUM_SERVER',
      wallets: ['a'],
      electrumServer: 'tcp://127.0.0.1:50001|BTCortex',
    });
  });

  it('merges changes, preserves every other key and backs the original up', async () => {
    const directory = home();
    const path = sparrowConfigPath(directory, 'mainnet');
    const original = {
      theme: 'DARK',
      recentWalletFiles: ['C:\\wallets\\a.mv.db'],
      serverType: 'PUBLIC_ELECTRUM_SERVER',
    };
    writeFileSync(path, JSON.stringify(original));
    const existing = await readSparrowConfig(path);
    const { backup } = await writeSparrowConfig(
      path,
      existing,
      planSparrowConnection(existing, target).changes,
      () => new Date('2026-10-21T10:00:00Z'),
    );

    const written = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    expect(written).toMatchObject({
      theme: 'DARK',
      recentWalletFiles: ['C:\\wallets\\a.mv.db'],
      serverType: 'BITCOIN_CORE',
      coreAuthType: 'COOKIE',
    });
    expect(backup).toBeDefined();
    expect(JSON.parse(readFileSync(backup ?? '', 'utf8'))).toEqual(original);
    expect(readdirSync(directory).some((name) => name.endsWith('.tmp'))).toBe(false);

    // A second write in the same instant keeps both backups.
    const second = await writeSparrowConfig(path, written, { theme: 'LIGHT' }, () => new Date('2026-10-21T10:00:00Z'));
    expect(second.backup).not.toBe(backup);
    expect(readdirSync(directory).filter((name) => name.endsWith('.bak'))).toHaveLength(2);
  });

  it('uses Sparrow’s network folders and network arguments', () => {
    expect(sparrowConfigPath('C:\\S', 'mainnet')).toBe(join('C:\\S', 'config'));
    expect(sparrowConfigPath('C:\\S', 'testnet3')).toBe(join('C:\\S', 'testnet3', 'config'));
    expect(sparrowConfigPath('C:\\S', 'regtest')).toBe(join('C:\\S', 'regtest', 'config'));
    expect(sparrowNetworkArgument('testnet3')).toBe('testnet');
    expect(sparrowNetworkArgument('testnet4')).toBe('testnet4');
  });

  it('detects network marker files that would override the network flag', () => {
    const directory = home();
    expect(activeNetworkMarkers(directory)).toEqual([]);
    writeFileSync(join(directory, 'network-signet'), '');
    expect(activeNetworkMarkers(directory)).toEqual(['signet']);
  });

  it('sets only the requested network markers aside and keeps them as backups', async () => {
    const directory = home();
    writeFileSync(join(directory, 'network-testnet'), '');
    writeFileSync(join(directory, 'network-testnet4'), '');
    const backups = await setAsideNetworkMarkers(directory, ['testnet3'], () => new Date('2026-10-21T10:00:00Z'));
    expect(backups).toEqual([join(directory, 'network-testnet.btcortex-2026-10-21T10-00-00-000Z.bak')]);
    expect(activeNetworkMarkers(directory)).toEqual(['testnet4']);
    expect(readdirSync(directory).sort()).toEqual([
      'network-testnet.btcortex-2026-10-21T10-00-00-000Z.bak',
      'network-testnet4',
    ]);
  });

  it('treats an unreadable configuration as absent', async () => {
    const directory = home();
    mkdirSync(join(directory, 'regtest'));
    const path = sparrowConfigPath(directory, 'regtest');
    writeFileSync(path, '{ not json');
    expect(await readSparrowConfig(path)).toBeUndefined();
    expect(await readSparrowConfig(join(directory, 'missing'))).toBeUndefined();
  });
});
