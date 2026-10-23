import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { MemorySink, StructuredLogger } from '../logging/logger';
import { ElectrumService } from './electrum-service';
import type { ElectrumServiceOptions } from './electrum-service';

// Removing an Electrum server, alone or with its node. The index of a node
// BTCortex did not set up lives inside the server's own folder by default, so
// only Fulcrum's files may go from there; the onion address is withdrawn
// before the settings that name it are forgotten.

const NODE_ID = 'node-external';
const SERVICE_ID = 'a'.repeat(56);

let root: string;
let home: string;
let index: string;
let settings: Map<string, unknown>;
let removeOnion: ReturnType<typeof vi.fn<(id: string, serviceId: string) => Promise<void>>>;
let removedSecrets: string[];
let service: ElectrumService;

function serverFolder(): string {
  return join(home, NODE_ID);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'btcortex-electrum-removal-'));
  home = join(root, 'electrum');
  // Where the plan puts the index of a node BTCortex did not set up: inside the server's own folder.
  index = join(serverFolder(), 'index');
  mkdirSync(index, { recursive: true });
  writeFileSync(join(index, 'btcortex-electrum.json'), JSON.stringify({ nodeId: NODE_ID }));
  writeFileSync(join(index, 'fulcrum-database.bin'), Buffer.alloc(64 * 1024));
  writeFileSync(join(serverFolder(), 'fulcrum.conf'), 'datadir = …\n');
  writeFileSync(join(serverFolder(), 'fulcrum.pid'), '4321\n');

  settings = new Map<string, unknown>([
    [
      'electrum',
      {
        servers: [
          {
            nodeId: NODE_ID,
            enabled: false,
            dataDirectory: index,
            ports: { electrum: 50001, admin: 50100, stats: 50150 },
            onion: { enabled: false, serviceId: SERVICE_ID, keySecretId: 'secret-onion' },
          },
        ],
      },
    ],
  ]);
  removeOnion = vi.fn<(id: string, serviceId: string) => Promise<void>>(() => Promise.resolve());
  removedSecrets = [];
  const options = {
    runtimesDirectory: join(root, 'runtimes'),
    home,
    logsDirectory: join(root, 'logs'),
    downloadsDirectory: join(root, 'downloads'),
    settings: {
      get: <T>(key: string, schema: z.ZodType<T>) => (settings.has(key) ? schema.parse(settings.get(key)) : undefined),
      set: (key: string, value: unknown) => {
        settings.set(key, JSON.parse(JSON.stringify(value)) as unknown);
      },
    },
    nodes: {
      list: () => [],
      get: () => {
        throw new Error('The node is gone.');
      },
      rpc: () => Promise.reject(new Error('Not used.')),
      restart: () => Promise.reject(new Error('Not used.')),
    },
    config: {
      get: () => Promise.reject(new Error('Not used.')),
      save: () => Promise.reject(new Error('Not used.')),
    },
    vault: {
      reveal: () => Promise.reject(new Error('Not used.')),
      store: () => Promise.reject(new Error('Not used.')),
      remove: (id: string) => {
        removedSecrets.push(id);
        return true;
      },
    },
    tor: {
      status: () => Promise.reject(new Error('Not used.')),
      ensureRunning: () => Promise.reject(new Error('Not used.')),
      publishOnion: () => Promise.reject(new Error('Not used.')),
      removeOnion,
    },
    jobs: { run: () => Promise.reject(new Error('Not used.')) },
    publish: () => undefined,
    logger: new StructuredLogger([new MemorySink()], 'debug'),
    totalMemoryBytes: 8 * 1024 ** 3,
    latestVersion: () => Promise.reject(new Error('Nothing is downloaded.')),
  } as unknown as ElectrumServiceOptions;
  service = new ElectrumService(options);
});

afterEach(async () => {
  await service.shutdown();
  rmSync(root, { recursive: true, force: true });
});

const servers = () => (settings.get('electrum') as { servers: unknown[] }).servers;

describe('Removing an Electrum server', () => {
  it('keeps the index of a node BTCortex did not set up, which lies in the server’s own folder', async () => {
    expect(await service.forgetNode(NODE_ID)).toBe(index);
    expect(existsSync(join(index, 'fulcrum-database.bin'))).toBe(true);
    expect(existsSync(join(index, 'btcortex-electrum.json'))).toBe(true);
    // Fulcrum's own files go; the onion address is withdrawn and its key deleted, even with access off.
    expect(existsSync(join(serverFolder(), 'fulcrum.conf'))).toBe(false);
    expect(existsSync(join(serverFolder(), 'fulcrum.pid'))).toBe(false);
    expect(removeOnion).toHaveBeenCalledWith(`electrum:${NODE_ID}`, SERVICE_ID);
    expect(removedSecrets).toEqual(['secret-onion']);
    expect(servers()).toEqual([]);
    // Nothing is left to remove a second time.
    expect(await service.forgetNode(NODE_ID)).toBeNull();
  });

  it('measures the index before deleting it when asked, and leaves no empty folder behind', async () => {
    const removal = await service.remove(NODE_ID, true);
    expect(removal).toEqual({ deletedBytes: expect.any(Number) as unknown, keptDirectory: null });
    expect(removal.deletedBytes).toBeGreaterThanOrEqual(64 * 1024);
    expect(existsSync(index)).toBe(false);
    expect(existsSync(serverFolder())).toBe(false);
  });

  it('keeps the server’s settings when its onion address cannot be withdrawn, so that removing it again finishes', async () => {
    removeOnion.mockRejectedValueOnce(new Error('tor did not answer'));
    await expect(service.forgetNode(NODE_ID)).rejects.toThrow('tor did not answer');
    expect(servers()).toHaveLength(1);
    expect(removedSecrets).toEqual([]);
    expect(existsSync(join(index, 'fulcrum-database.bin'))).toBe(true);

    expect(await service.forgetNode(NODE_ID)).toBe(index);
    expect(removeOnion).toHaveBeenCalledTimes(2);
    expect(removedSecrets).toEqual(['secret-onion']);
    expect(servers()).toEqual([]);
  });
});
