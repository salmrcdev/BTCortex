import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATALOGUE_RECORDS } from '@btcortex/catalogue';
import type {
  DetectionReport,
  LightningConnectionWithStatus,
  LightningStatus,
  NodeWithStatus,
  TorStatus,
} from '@btcortex/contracts';
import { MemorySink, StructuredLogger } from '../logging/logger';
import {
  bitcoinCoreAdapter,
  bitcoinKnotsAdapter,
  electrumWalletAdapter,
  fulcrumAdapter,
  hwiAdapter,
  lndAdapter,
  remoteExplorerAdapter,
  signingDeviceAdapter,
  sparrowAdapter,
  torAdapter,
  trezorSuiteAdapter,
} from './adapters';
import { CatalogueService } from './catalogue-service';
import type { ServiceAdapter } from './service-adapter';

const logger = new StructuredLogger([new MemorySink()], 'debug');

function node(id: string, state: NodeWithStatus['status']['state'], runtimeVersion: string | null): NodeWithStatus {
  return {
    profile: { id, implementation: 'bitcoin-core', runtimeVersion },
    status: { nodeId: id, state, checkedAt: '2026-10-21T10:00:00.000Z' },
  } as NodeWithStatus;
}

const detection: DetectionReport = {
  dataDirectories: [],
  installations: [
    { path: 'C:\\Program Files\\Bitcoin', product: 'Bitcoin Core', version: '30.2', source: 'registry' },
    { path: 'C:\\Program Files\\Knots', product: 'Bitcoin Knots', version: '29.4.2', source: 'program-files' },
  ],
};

describe('service adapters', () => {
  it('reports Bitcoin Core nodes and installations, the worst node first', async () => {
    const adapter = bitcoinCoreAdapter({
      nodes: () => [node('a', 'running', '31.1'), node('b', 'failed', '31.1')],
      detect: () => Promise.resolve(detection),
    });
    expect(await adapter.state()).toEqual({
      installed: true,
      versions: ['31.1', '30.2'],
      running: 1,
      health: 'failed',
      summary: '2 nodes in BTCortex, 1 running; 1 installation found on this computer.',
    });
    // Updating and removing are not offered until they exist.
    expect(adapter.capabilities).not.toContain('update');
    expect(adapter.capabilities).not.toContain('uninstall');
  });

  it('counts only Knots nodes for Bitcoin Knots, beside the installations found', async () => {
    const adapter = bitcoinKnotsAdapter({
      nodes: () => [node('a', 'running', '31.1')],
      detect: () => Promise.resolve(detection),
    });
    expect(adapter.level).toBe('fully-managed');
    // The Bitcoin Core nodes are not Knots nodes.
    expect(await adapter.state()).toMatchObject({
      installed: true,
      versions: ['29.4.2'],
      running: 0,
      summary: 'No Knots node in BTCortex; 1 installation found on this computer.',
    });
  });

  it('reports Sparrow as installed by BTCortex, open or not', async () => {
    const installed = sparrowAdapter({
      summary: () => Promise.resolve({ installed: '2.5.5', running: true, settingsFound: true }),
    });
    expect(await installed.state()).toMatchObject({
      installed: true,
      running: 1,
      health: 'healthy',
      summary: 'Sparrow 2.5.5 installed by BTCortex, open now.',
    });
    const elsewhere = sparrowAdapter({
      summary: () => Promise.resolve({ installed: null, running: false, settingsFound: true }),
    });
    expect((await elsewhere.state()).summary).toBe('Used on this computer before, but not installed by BTCortex.');
  });

  it('declares the same evidence as the implementation status page', () => {
    const features = JSON.parse(
      readFileSync(
        join(resolve(import.meta.dirname, '..', '..', '..', '..'), 'docs', 'implementation', 'features.json'),
        'utf8',
      ),
    ) as { id: string; state: string }[];
    const state = (id: string) => features.find((feature) => feature.id === id)?.state;
    expect(bitcoinCoreAdapter({ nodes: () => [], detect: () => Promise.resolve(detection) }).status).toBe(
      state('bitcoin-core-lifecycle'),
    );
    expect(sparrowAdapter({ summary: () => Promise.reject(new Error('unused')) }).status).toBe(
      state('sparrow-integration'),
    );
    expect(torAdapter({ status: () => Promise.reject(new Error('unused')) }).status).toBe(state('tor-integration'));
    const unused = { overview: () => Promise.reject(new Error('unused')) };
    expect(hwiAdapter(unused).status).toBe(state('hardware-wallets'));
    expect(signingDeviceAdapter('trezor', 'trezor', 'Trezor', unused).status).toBe(state('hardware-wallets'));
    expect(trezorSuiteAdapter(unused).status).toBe(state('trezor-suite'));
    expect(fulcrumAdapter(unused).status).toBe(state('electrum-servers'));
    expect(electrumWalletAdapter({ summary: () => Promise.reject(new Error('unused')) }).status).toBe(
      state('electrum-wallet'),
    );
    expect(lndAdapter({ connections: () => [] }).status).toBe(state('lightning-lnd'));
    expect(remoteExplorerAdapter('mempool', { explorers: () => [] }).status).toBe(state('remote-explorers'));
    expect(remoteExplorerAdapter('esplora', { explorers: () => [] }).status).toBe(state('remote-explorers'));
  });

  it('reports LND connections by their state, a refused one needing attention', async () => {
    const connection = (state: LightningStatus['state'], local: boolean) =>
      ({
        connection: { id: state, local },
        status: { connectionId: state, state, version: '0.21.4-beta' },
      }) as LightningConnectionWithStatus;
    expect(await lndAdapter({ connections: () => [] }).state()).toMatchObject({
      installed: false,
      health: 'unknown',
      summary: 'No LND node connected.',
    });
    expect(await lndAdapter({ connections: () => [connection('ready', true)] }).state()).toEqual({
      installed: true,
      versions: ['0.21.4-beta'],
      running: 1,
      health: 'healthy',
      summary: '1 LND node connected: 1 ready.',
    });
    expect(
      await lndAdapter({ connections: () => [connection('ready', false), connection('unauthorised', false)] }).state(),
    ).toMatchObject({ installed: false, health: 'attention', summary: '2 LND nodes connected: 1 ready.' });
  });

  it('reports Tor as tor reports itself: connecting, connected, or only installed', async () => {
    const base: TorStatus = {
      state: 'starting',
      installed: { version: '15.0.26', torVersion: '0.4.9.14', verifiedAt: '2026-10-23T01:00:00.000Z' },
      runningVersion: '15.0.26',
      autoStart: true,
      ports: { socks: 9050, applicationSocks: 9052, control: 9054 },
      bootstrap: {
        progress: 45,
        summary: 'Asking for relay descriptors',
        tag: 'requesting_descriptors',
        stalled: false,
      },
      circuitEstablished: false,
      networkLiveness: 'up',
      versionStatus: null,
      startedAt: null,
      traffic: null,
      pid: 4242,
      recentLines: [],
      external: [],
      usedBy: [{ id: 'node-1', name: 'Main node', running: true, kind: 'node' }],
    };
    const adapter = (status: TorStatus) => torAdapter({ status: () => Promise.resolve(status) });
    expect(await adapter(base).state()).toMatchObject({
      installed: true,
      running: 1,
      health: 'working',
      summary: 'Tor 15.0.26 (tor 0.4.9.14) connecting to the Tor network (45 %); used by 1 node.',
    });
    expect(await adapter({ ...base, state: 'running', circuitEstablished: true }).state()).toMatchObject({
      health: 'healthy',
      summary: 'Tor 15.0.26 (tor 0.4.9.14) connected to the Tor network; used by 1 node.',
    });
    expect(
      await adapter({ ...base, state: 'not-installed', installed: null, pid: null, usedBy: [] }).state(),
    ).toMatchObject({ installed: false, health: 'unknown', summary: 'Not set up.' });
  });
});

describe('CatalogueService', () => {
  const failing: ServiceAdapter = {
    id: 'sparrow',
    status: 'unit-tested',
    level: 'connected-application',
    capabilities: ['open'],
    route: '/nodes',
    state: () => Promise.reject(new Error('tasklist failed')),
  };

  const service = (adapters: ServiceAdapter[]) => new CatalogueService({ adapters, logger });

  it('lists every researched entry, research only unless an adapter says otherwise', async () => {
    const core = bitcoinCoreAdapter({
      nodes: () => [node('a', 'running', '31.1')],
      detect: () => Promise.resolve(detection),
    });
    const entries = await service([core, failing]).list();
    expect(entries).toHaveLength(CATALOGUE_RECORDS.length);
    expect(entries.find((entry) => entry.id === 'bitcoin-core')?.integration).toMatchObject({
      status: 'verified-on-windows',
      level: 'fully-managed',
      state: { installed: true, running: 1, health: 'healthy' },
    });
    // A failing adapter keeps its declarations; only its live state is missing.
    expect(entries.find((entry) => entry.id === 'sparrow')?.integration).toMatchObject({
      level: 'connected-application',
      state: null,
    });
    const fulcrum = entries.find((entry) => entry.id === 'fulcrum');
    expect(fulcrum?.targetLevel).toBe('fully-managed');
    expect(fulcrum?.integration).toEqual({
      status: 'researched',
      level: null,
      capabilities: [],
      route: null,
      state: null,
    });
  });

  it('checks an entry’s dependencies against what is on this computer', async () => {
    const core = bitcoinCoreAdapter({
      nodes: () => [node('a', 'running', '31.1')],
      detect: () => Promise.resolve(detection),
    });
    const detail = await service([core]).entry('fulcrum');
    const requiresCore = detail.dependencies.checks.find(
      (check) => check.relationship === 'requires' && check.ids.includes('bitcoin-core'),
    );
    expect(requiresCore?.present).toEqual(['bitcoin-core']);
    expect(detail.dependencies.order.at(-1)).toBe('fulcrum');
    expect(detail.names['bitcoin-core']).toBe('Bitcoin Core');
    await expect(service([]).entry('no-such-entry')).rejects.toMatchObject({ error: { code: 'catalogue.not-found' } });
  });
});
