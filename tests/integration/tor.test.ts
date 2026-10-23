import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildTorrc,
  connectAuthenticated,
  parseBootstrapStatus,
  parseTorLogLine,
  probeControlPort,
  readTorLogTail,
  startTorProcess,
  torArguments,
  torLayout,
  TORRC_DEFAULTS,
} from '@btcortex/integration-tor';
import type { TorPorts, TorProcess } from '@btcortex/integration-tor';
import { freePort } from './support/regtest-node';

// The real tor from the verified Expert Bundle in .test-env (installed by
// scripts/dev/install-tor.ts), started with DisableNetwork 1: it configures
// itself and opens its listeners but never contacts the Tor network.

const RUNTIMES = resolve(import.meta.dirname, '..', '..', '.test-env', 'tor', 'runtimes');

function findTestTorBundle(): string | undefined {
  if (!existsSync(RUNTIMES)) return undefined;
  for (const version of readdirSync(RUNTIMES).sort().reverse()) {
    const bundle = join(RUNTIMES, version);
    if (existsSync(join(bundle, 'tor', 'tor.exe'))) return bundle;
  }
  return undefined;
}

const bundle = findTestTorBundle();

async function waitFor<T>(probe: () => Promise<T | undefined>, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe().catch(() => undefined);
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('Timed out waiting for tor.');
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
}

describe.skipIf(!bundle)('a real tor, offline', () => {
  let home: string;
  let ports: TorPorts;
  let tor: TorProcess | undefined;

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'btcortex-tor-'));
    ports = { socks: await freePort(), applicationSocks: await freePort(), control: await freePort() };
    const layout = torLayout(home);
    mkdirSync(layout.data, { recursive: true });
    mkdirSync(layout.onionAuth, { recursive: true });
    writeFileSync(layout.torrc, buildTorrc(ports));
    writeFileSync(layout.defaults, TORRC_DEFAULTS);
    tor = await startTorProcess({
      executable: join(bundle ?? '', 'tor', 'tor.exe'),
      bundle: bundle ?? '',
      args: torArguments({ bundle: bundle ?? '', home, ownerPid: process.pid, disableNetwork: true }),
      logFile: join(home, 'tor.log'),
    });
  });

  afterEach(async () => {
    if (tor?.child.exitCode === null) {
      tor.child.kill();
      await tor.exited;
    }
    rmSync(home, { recursive: true, force: true });
  });

  it('starts, authenticates with SAFECOOKIE, reports its state, and exits when its owner connection closes', async () => {
    const layout = torLayout(home);
    const connection = await waitFor(
      async () => (existsSync(layout.cookie) ? connectAuthenticated(ports.control, layout.cookie) : undefined),
      30_000,
    );
    const info = await connection.getInfo([
      'version',
      'status/bootstrap-phase',
      'net/listeners/socks',
      'process/pid',
      'network-liveness',
    ]);
    expect(info.get('version')).toMatch(/^0\.4\.\d+\.\d+/);
    expect(info.get('process/pid')).toBe(String(tor?.pid));
    // With DisableNetwork tor accepts controller connections only, so no SOCKS port is open yet.
    expect(info.get('net/listeners/socks')).toBe('');
    // Offline, so the bootstrap has not gone anywhere.
    const bootstrap = parseBootstrapStatus(info.get('status/bootstrap-phase') ?? '');
    expect(bootstrap?.progress).toBeLessThan(100);

    // PROTOCOLINFO, as BTCortex probes other software's tor, reports the cookie method and version.
    expect(await probeControlPort(ports.control)).toMatchObject({
      methods: expect.arrayContaining(['SAFECOOKIE']) as unknown,
      torVersion: info.get('version')?.split(' ')[0],
    });

    await connection.setEvents(['STATUS_CLIENT', 'STATUS_GENERAL']);
    await connection.takeOwnership();
    connection.close();
    const exit = await Promise.race([
      tor?.exited,
      new Promise((resolveTimeout) => {
        setTimeout(() => {
          resolveTimeout('still running');
        }, 20_000);
      }),
    ]);
    expect(exit).not.toBe('still running');
    const logged = readTorLogTail(join(home, 'tor.log'), 200).map(parseTorLogLine);
    expect(logged).toContainEqual(expect.objectContaining({ severity: 'notice' }));
  });

  it('stops cleanly on SIGNAL SHUTDOWN', async () => {
    const layout = torLayout(home);
    const connection = await waitFor(
      async () => (existsSync(layout.cookie) ? connectAuthenticated(ports.control, layout.cookie) : undefined),
      30_000,
    );
    await connection.signal('SHUTDOWN').catch(() => undefined);
    const exit = await tor?.exited;
    expect(exit?.code).toBe(0);
  });
});
