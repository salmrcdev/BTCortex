import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import type { Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { z } from 'zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppFailure } from '@btcortex/contracts';
import type { OrchestratorEvent, TorPorts } from '@btcortex/contracts';
import { isProcessAlive } from '@btcortex/integration-tor';
import { MemorySink, StructuredLogger } from '../../apps/orchestrator/src/logging/logger';
import { TorService } from '../../apps/orchestrator/src/tor/tor-service';
import type { TorServiceOptions, TorUser } from '../../apps/orchestrator/src/tor/tor-service';
import { freePort } from './support/regtest-node';

// BTCortex's tor service with the real tor from .test-env (installed by
// scripts/dev/install-tor.ts), offline: it starts, reports what tor says,
// survives BTCortex closing while a node needs it, is found again by the next
// session, restarts after a crash and refuses a port someone else holds.

const RUNTIMES = resolve(import.meta.dirname, '..', '..', '.test-env', 'tor', 'runtimes');
const installed = existsSync(RUNTIMES) && readdirSync(RUNTIMES).length > 0;

function memorySettings(): TorServiceOptions['settings'] {
  const values = new Map<string, string>();
  return {
    get: <T>(key: string, schema: z.ZodType<T>) => {
      const value = values.get(key);
      if (value === undefined) return undefined;
      const parsed = schema.safeParse(JSON.parse(value));
      return parsed.success ? parsed.data : undefined;
    },
    set: (key: string, value: unknown) => {
      values.set(key, JSON.stringify(value));
    },
  };
}

async function until(check: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out.');
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
}

describe.skipIf(!installed)('the tor service with a real tor, offline', () => {
  let root: string;
  let ports: TorPorts;
  let settings: TorServiceOptions['settings'];
  const services: TorService[] = [];
  const servers: Server[] = [];
  const pids: number[] = [];

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'btcortex-tor-service-'));
    ports = { socks: await freePort(), applicationSocks: await freePort(), control: await freePort() };
    settings = memorySettings();
    settings.set('tor', { autoStart: false, ports });
  });

  afterEach(async () => {
    for (const service of services.splice(0)) await service.stop().catch(() => undefined);
    for (const server of servers.splice(0)) server.close();
    for (const pid of pids.splice(0)) {
      if (isProcessAlive(pid)) process.kill(pid);
    }
    rmSync(root, { recursive: true, force: true });
  });

  function service(users: () => Promise<TorUser[]> = () => Promise.resolve([])) {
    const events: OrchestratorEvent[] = [];
    const created = new TorService({
      runtimesDirectory: RUNTIMES,
      home: join(root, 'tor'),
      logsDirectory: join(root, 'logs'),
      downloadsDirectory: join(root, 'downloads'),
      settings,
      jobs: { run: () => ({ id: 'unused' }) as never },
      publish: (event) => events.push(event),
      logger: new StructuredLogger([new MemorySink()], 'debug'),
      users,
      detectExternal: () => Promise.resolve([]),
      offline: true,
    });
    services.push(created);
    return { tor: created, events };
  }

  it('starts tor, keeps it for a node that keeps running after BTCortex closes, and the next session finds it', async () => {
    const first = service(() =>
      Promise.resolve([{ id: 'node-1', name: 'Main node', running: true, keepRunningOnExit: true }]),
    );
    const started = await first.tor.start();
    expect(started.state).toBe('starting');
    expect(started.ports).toEqual(ports);
    expect(started.installed?.torVersion).toMatch(/^0\.4\./);
    expect(started.runningVersion).toBe(started.installed?.version);
    expect(started.bootstrap?.progress).toBeLessThan(100);
    expect(started.recentLines.length).toBeGreaterThan(0);
    const pid = started.pid ?? 0;
    pids.push(pid);
    expect(isProcessAlive(pid)).toBe(true);

    await first.tor.shutdown();
    services.splice(services.indexOf(first.tor), 1);
    expect(isProcessAlive(pid)).toBe(true);

    const second = service();
    const found = await second.tor.start();
    expect(found.pid).toBe(pid);
    expect(found.runningVersion).toBe(started.runningVersion);
    expect(found.state).toBe('starting');

    const stopped = await second.tor.stop();
    expect(stopped.state).toBe('stopped');
    expect(isProcessAlive(pid)).toBe(false);
  });

  it('starts tor again after it crashes, and reports why it stopped', async () => {
    const { tor } = service();
    const started = await tor.start();
    const pid = started.pid ?? 0;
    pids.push(pid);
    process.kill(pid);
    await until(() => !isProcessAlive(pid), 10_000);
    let crashed = await tor.status();
    for (let attempt = 0; attempt < 30 && crashed.state !== 'failed'; attempt += 1) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      crashed = await tor.status();
    }
    expect(crashed.state).toBe('failed');
    expect(crashed.error?.code).toBe('tor.exited');

    // The first automatic restart comes after five seconds.
    let again = crashed;
    const deadline = Date.now() + 20_000;
    while (again.pid === null && Date.now() < deadline) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 500));
      again = await tor.status();
    }
    expect(again.pid).not.toBeNull();
    expect(again.pid).not.toBe(pid);
    pids.push(again.pid ?? 0);
    expect(again.state).toBe('starting');
  });

  it('settles its ports before it ever runs, so that nodes can be pointed at them', async () => {
    settings = memorySettings();
    const { tor } = service();
    const chosen = await tor.fixedPorts();
    expect(new Set(Object.values(chosen)).size).toBe(3);
    expect(await tor.fixedPorts()).toEqual(chosen);
    expect(tor.ports()).toEqual(chosen);
    expect(tor.isRunning()).toBe(false);
  });

  it('refuses to start when another program holds one of its ports', async () => {
    const holder = createServer();
    servers.push(holder);
    await new Promise<void>((resolveListen) => holder.listen(ports.control, '127.0.0.1', resolveListen));
    const { tor } = service();
    const error = await tor.start().catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(AppFailure);
    expect((error as AppFailure).error).toMatchObject({ code: 'tor.port-in-use', details: { port: ports.control } });
    expect((await tor.status()).state).toBe('failed');
  });
});
