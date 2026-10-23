import { describe, expect, it } from 'vitest';
import type {
  Alert,
  BackupSettings,
  ElectrumOverview,
  InstalledSoftware,
  LightningConnectionWithStatus,
  NodeConfigDocument,
  NodeWithStatus,
  TorStatus,
} from '@btcortex/contracts';
import { MemorySink, StructuredLogger } from '../logging/logger';
import { SecurityService } from './security-service';
import type { ComputerFacts } from './security-service';

interface NodeOptions {
  implementation?: 'bitcoin-core' | 'bitcoin-knots';
  id: string;
  version?: number;
  managed?: boolean;
  endpoint?: string;
  password?: boolean;
  subversion?: string;
  network?: string;
}

function node(options: NodeOptions): NodeWithStatus {
  return {
    profile: {
      id: options.id,
      name: `Node ${options.id}`,
      implementation: options.implementation ?? 'bitcoin-core',
      network: options.network ?? 'mainnet',
      execution: options.managed === false ? 'external' : 'managed',
      runtimeVersion: '31.1',
      dataDirectory: 'D:\\Bitcoin',
      rpcEndpoint: options.endpoint ?? 'http://127.0.0.1:8332',
      authentication: options.password
        ? { kind: 'password', username: 'me', secretId: 's1' }
        : { kind: 'cookie', cookieFile: 'D:\\Bitcoin\\.cookie' },
    },
    status: {
      nodeId: options.id,
      state: 'running',
      checkedAt: '2026-10-23T08:00:00.000Z',
      ...(options.version === undefined
        ? {}
        : {
            snapshot: { network: { version: options.version, subversion: options.subversion ?? '/Satoshi:31.1.0/' } },
          }),
    },
  } as unknown as NodeWithStatus;
}

interface World {
  nodes: NodeWithStatus[];
  configs: Record<string, string | null>;
  tor?: Partial<TorStatus>;
  lightning?: LightningConnectionWithStatus[];
  software?: Partial<InstalledSoftware>[];
  backups?: Partial<BackupSettings>;
  alerts?: Alert[];
  computer?: ComputerFacts;
}

function setUp(world: World) {
  let computerChecks = 0;
  let clock = Date.parse('2026-10-23T08:00:00.000Z');
  const service = new SecurityService({
    nodes: () => world.nodes,
    config: {
      get: (nodeId) => {
        const text = world.configs[nodeId] ?? null;
        return Promise.resolve({
          path: text === null ? null : 'D:\\Bitcoin\\bitcoin.conf',
          exists: text !== null,
          editable: true,
          text: text ?? '',
          revision: 'r1',
          restartRequired: false,
          commandLine: [],
        } satisfies NodeConfigDocument);
      },
    },
    tor: () => (world.tor ? Promise.resolve(world.tor as TorStatus) : Promise.reject(new Error('no tor'))),
    electrum: () =>
      Promise.resolve({
        installed: null,
        servers: [{ nodeId: 'a', nodeName: 'Node a', state: 'ready', remoteAccess: { enabled: true, onion: null } }],
      } as unknown as ElectrumOverview),
    lightning: () => world.lightning ?? [],
    installations: () => Promise.resolve((world.software ?? []) as InstalledSoftware[]),
    secrets: () => [{ purpose: 'Node password' }, { purpose: 'Macaroon' }],
    backups: () => ({
      destination: null,
      retention: 10,
      schedule: { everyHours: 0, encrypted: false },
      passphraseStored: false,
      lastRun: null,
      ...world.backups,
    }),
    alerts: () => world.alerts ?? [],
    paths: { root: 'C:\\Users\\me\\AppData\\Local\\BTCortex' },
    logger: new StructuredLogger([new MemorySink()], 'debug'),
    now: () => new Date(clock),
    computer: () => {
      computerChecks += 1;
      return Promise.resolve(world.computer);
    },
  });
  return {
    service,
    checks: () => computerChecks,
    later: (minutes: number) => {
      clock += minutes * 60_000;
    },
  };
}

describe('security centre', () => {
  it('finds what exposes a node and says what to do, most serious first', async () => {
    const { service } = setUp({
      nodes: [node({ id: 'a', version: 310100 })],
      configs: {
        a: [
          'server=1',
          'rpcbind=0.0.0.0',
          'rpcallowip=0.0.0.0/0',
          'rest=1',
          'rpcpassword=hunter2',
          'blocknotify=curl http://example.com/%s',
          'zmqpubrawblock=tcp://0.0.0.0:28332',
          'natpmp=1',
        ].join('\n'),
      },
    });
    const overview = await service.overview();
    const ids = overview.findings.map((finding) => `${finding.severity}:${finding.id}`);
    expect(ids.slice(0, 1)).toEqual(['critical:node.rpc-exposed:a']);
    expect(ids).toEqual(
      expect.arrayContaining([
        'warning:node.rest:a',
        'warning:node.rpcpassword:a',
        'warning:node.zmq:a',
        'info:node.commands:a',
        'info:node.port-mapping:a',
        'ok:node.cookie:a',
      ]),
    );
    const exposed = overview.findings.find((finding) => finding.id === 'node.rpc-exposed:a');
    expect(exposed).toMatchObject({ title: 'RPC is open to any address', route: '/nodes/a/configuration' });
    expect(overview.findings.find((finding) => finding.id === 'node.zmq:a')?.detail).toBe(
      'zmqpubrawblock=tcp://0.0.0.0:28332 publishes to other computers without authentication.',
    );
    expect(overview.counts.critical).toBe(1);
    expect(overview.controls.map((control) => control.state)).toContain('planned');
  });

  it('rates node versions by the research’s warning matrix and flags passwords sent in clear', async () => {
    const { service } = setUp({
      nodes: [
        node({ id: 'old', version: 240000 }),
        node({ id: 'eol', version: 280100 }),
        node({ id: 'withdrawn', version: 300100, managed: false }),
        node({ id: 'current', version: 310100 }),
        node({ id: 'remote', version: 310100, endpoint: 'http://192.168.1.20:8332', password: true }),
      ],
      configs: { current: 'server=1\n' },
    });
    const findings = (await service.overview()).findings;
    const version = (id: string) => findings.find((finding) => finding.id === `node.version:${id}`);
    expect(version('old')?.severity).toBe('critical');
    expect(version('eol')?.severity).toBe('warning');
    expect(version('withdrawn')).toMatchObject({
      severity: 'warning',
      action: 'Update Bitcoin Core with the program that installed it.',
    });
    expect(version('current')).toBeUndefined();
    expect(findings.some((finding) => finding.id.startsWith('node.other-chain:'))).toBe(false);
    expect(findings.find((finding) => finding.id === 'node.rpc-local:current')?.severity).toBe('ok');
    expect(findings.find((finding) => finding.id === 'node.plain-http:remote')?.detail).toMatch(
      /reaches 192\.168\.1\.20 over plain HTTP/,
    );
  });

  it('says when a Bitcoin Knots node follows a chain Bitcoin Core rejects, without calling it an outdated Core', async () => {
    const { service } = setUp({
      nodes: [
        node({ id: 'forked', version: 290402, subversion: '/Satoshi:29.4.2/Knots:20260508/', managed: false }),
        node({
          id: 'test',
          version: 290402,
          subversion: '/Satoshi:29.4.2/Knots:20260508/',
          managed: false,
          network: 'testnet4',
        }),
        node({ id: 'older', version: 290300, subversion: '/Satoshi:29.3.0/Knots:20260210/', managed: false }),
        // Set up by BTCortex after the user agreed to its chain.
        node({
          id: 'agreed',
          version: 290402,
          subversion: '/Satoshi:29.4.2/Knots:20260508/',
          implementation: 'bitcoin-knots',
        }),
      ],
      configs: {},
    });
    const findings = (await service.overview()).findings;
    expect(findings.find((finding) => finding.id === 'node.other-chain:forked')).toMatchObject({
      severity: 'critical',
      title: 'A node on another chain',
    });
    expect(findings.find((finding) => finding.id === 'node.other-chain:test')?.severity).toBe('warning');
    expect(findings.find((finding) => finding.id === 'node.other-chain:older')).toBeUndefined();
    expect(findings.find((finding) => finding.id === 'node.other-chain:agreed')?.severity).toBe('info');
    // Knots versions follow their own numbering: no "outdated Bitcoin Core" for them.
    expect(findings.some((finding) => finding.id.startsWith('node.version:'))).toBe(false);
  });

  it('covers Tor, Electrum, Lightning, software, secrets, backups and security alerts', async () => {
    const { service } = setUp({
      nodes: [],
      configs: {},
      tor: {
        installed: { version: '15.0.1', torVersion: '0.4.8.1', verifiedAt: '2026-10-01T00:00:00.000Z' },
        versionStatus: 'obsolete',
      },
      lightning: [
        {
          connection: { id: 'c1', name: 'LND', certificateFingerprint: null, macaroon: { access: 'admin' } },
          status: { alias: 'bob' },
        } as unknown as LightningConnectionWithStatus,
      ],
      software: [
        { product: 'tor', version: '15.0.1', signatures: { valid: 1, required: 1 }, integrityRecorded: true },
        { product: 'hwi', version: '3.2.0', signatures: { valid: 1, required: 1 }, integrityRecorded: false },
      ],
      alerts: [
        {
          id: 'config.changed:n1',
          rule: 'config.changed',
          severity: 'warning',
          component: 'Main node',
          title: 'bitcoin.conf of Main node changed outside BTCortex',
          message: 'rpcallowip now 0.0.0.0/0.',
          route: '/nodes/n1/configuration',
        } as Alert,
      ],
    });
    const findings = (await service.overview()).findings;
    const severity = (id: string) => findings.find((finding) => finding.id === id)?.severity;
    expect(severity('tor.version')).toBe('warning');
    expect(severity('electrum.onion:a')).toBe('info');
    expect(severity('lightning.macaroon:c1')).toBe('warning');
    expect(severity('lightning.certificate:c1')).toBe('info');
    expect(severity('software.verified')).toBe('ok');
    expect(severity('software.integrity')).toBe('info');
    expect(severity('backups.none')).toBe('warning');
    expect(severity('alert:config.changed:n1')).toBe('warning');
    expect(findings.find((finding) => finding.id === 'secrets.vault')?.detail).toBe(
      '2 secrets are encrypted with Windows DPAPI for your account; none ever reaches the window.',
    );
  });

  it('checks the firewall and who can read BTCortex’s data, at most every ten minutes', async () => {
    const world: World = {
      nodes: [],
      configs: {},
      computer: {
        firewall: [
          { name: 'Domain', enabled: true },
          { name: 'Public', enabled: false },
        ],
        others: ['BUILTIN\\Users'],
      },
    };
    const { service, checks, later } = setUp(world);
    const findings = (await service.overview()).findings;
    expect(findings.find((finding) => finding.id === 'computer.firewall')).toMatchObject({
      severity: 'warning',
      detail: 'It is off for the Public profile.',
    });
    expect(findings.find((finding) => finding.id === 'computer.data-folder')?.detail).toBe(
      'BUILTIN\\Users has access to C:\\Users\\me\\AppData\\Local\\BTCortex.',
    );
    await service.overview();
    expect(checks()).toBe(1);
    later(11);
    world.computer = { firewall: [{ name: 'Public', enabled: true }], others: [] };
    const again = (await service.overview()).findings;
    expect(checks()).toBe(2);
    expect(again.find((finding) => finding.id === 'computer.firewall')?.severity).toBe('ok');
    expect(again.find((finding) => finding.id === 'computer.data-folder')?.severity).toBe('ok');
  });
});
