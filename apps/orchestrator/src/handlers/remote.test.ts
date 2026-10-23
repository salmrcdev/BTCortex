import { describe, expect, it } from 'vitest';
import type { LightningStatus, PaymentServerStatus, RemoteTestResult } from '@btcortex/contracts';
import { MemorySink, StructuredLogger } from '../logging/logger';
import { Dispatcher } from '../rpc/dispatcher';
import type { BitcoinRpcClient } from '@btcortex/bitcoin-rpc';
import { registerRemoteHandlers } from './remote';

const NOW = new Date('2026-10-23T12:00:00.000Z');

function setUp(world: {
  nodeDown?: boolean;
  lightning?: Partial<LightningStatus>;
  payments?: Partial<PaymentServerStatus>;
}) {
  const dispatcher = new Dispatcher(new StructuredLogger([new MemorySink()], 'debug'));
  registerRemoteHandlers(dispatcher, {
    nodes: {
      rpc: () =>
        ({
          call: () =>
            world.nodeDown
              ? Promise.reject(new Error('Nothing answers at 192.168.1.20:8332.'))
              : Promise.resolve({ subversion: '/Satoshi:31.1.0/', connections: 10 }),
        }) as unknown as BitcoinRpcClient,
    },
    lightning: {
      refresh: () =>
        Promise.resolve({ connectionId: 'c1', state: 'ready', alias: 'bob', ...world.lightning } as LightningStatus),
    },
    payments: {
      test: () =>
        Promise.resolve({
          serverId: 'p1',
          state: 'online',
          checkedAt: NOW.toISOString(),
          version: '2.4.5',
          onion: null,
          chains: [],
          error: null,
          unreachableSince: null,
          ...world.payments,
        }),
    },
    electrum: {
      checkOne: () =>
        Promise.resolve({
          state: 'online',
          serverVersion: 'electrs/0.10.9',
          network: 'mainnet',
          height: 968_000,
          checkedAt: NOW.toISOString(),
          error: null,
          unreachableSince: null,
        }),
    },
    explorers: {
      checkOne: () =>
        Promise.resolve({
          state: 'online',
          network: 'mainnet',
          height: 968_000,
          blocksBehind: 2,
          checkedAt: NOW.toISOString(),
          error: null,
          unreachableSince: null,
        }),
    },
    now: () => NOW,
  });
  return (kind: string, id: string) =>
    dispatcher.dispatch({ method: 'remote.test', params: { kind, id }, origin: 'ui' }) as Promise<RemoteTestResult>;
}

describe('remote connection tests', () => {
  it('times one round trip and says what answered', async () => {
    const test = setUp({});
    const node = await test('bitcoin-node', 'n1');
    expect(node).toMatchObject({
      ok: true,
      detail: 'Answered as /Satoshi:31.1.0/ with 10 peers.',
      testedAt: NOW.toISOString(),
    });
    expect(node.latencyMs).toBeGreaterThanOrEqual(0);
    expect(await test('lightning', 'c1')).toMatchObject({ ok: true, detail: 'LND answered as bob.' });
    expect(await test('payments', 'p1')).toMatchObject({ ok: true, detail: 'BTCPay Server 2.4.5 answered.' });
    expect(await test('electrum', 'e1')).toMatchObject({
      ok: true,
      detail: 'electrs/0.10.9 answered at block 968000.',
    });
    expect(await test('explorer', 'x1')).toMatchObject({
      ok: true,
      detail: 'The explorer answered at block 968000, 2 behind the node.',
    });
  });

  it('reports a failure as a result, without a latency', async () => {
    const test = setUp({
      nodeDown: true,
      lightning: {
        state: 'unreachable',
        error: { message: 'Nothing answers at 10.0.0.5:8080.' } as LightningStatus['error'],
      },
      payments: { state: 'unauthorised', error: 'Shop refused the API key.' },
    });
    expect(await test('bitcoin-node', 'n1')).toEqual({
      ok: false,
      latencyMs: null,
      detail: 'Nothing answers at 192.168.1.20:8332.',
      testedAt: NOW.toISOString(),
    });
    expect(await test('lightning', 'c1')).toMatchObject({
      ok: false,
      latencyMs: null,
      detail: 'Nothing answers at 10.0.0.5:8080.',
    });
    expect(await test('payments', 'p1')).toMatchObject({ ok: false, detail: 'Shop refused the API key.' });
  });
});
