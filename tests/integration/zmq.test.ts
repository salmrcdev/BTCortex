import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NodeWithStatus, OrchestratorEvent } from '@btcortex/contracts';
import { interpretZmqMessage, subscribeZmq } from '@btcortex/integration-bitcoin-core';
import type { ZmqEvent, ZmqSubscriber } from '@btcortex/integration-bitcoin-core';
import { ZmqWatchService } from '../../apps/orchestrator/src/devtools/zmq-watch';
import { MemorySink, StructuredLogger } from '../../apps/orchestrator/src/logging/logger';
import { findTestBitcoind, freePort, removeTestRoot, startRegtestNode } from './support/regtest-node';
import type { RegtestNode } from './support/regtest-node';

// BTCortex's ZMTP subscriber against the libzmq inside a real bitcoind on
// Windows: block hashes and mempool sequence notifications arrive for a
// mined block and a wallet transaction.

const bitcoind = findTestBitcoind();

async function until(events: ZmqEvent[], accept: (event: ZmqEvent) => boolean, timeoutMs = 20_000): Promise<ZmqEvent> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = events.find(accept);
    if (found) return found;
    if (Date.now() > deadline) throw new Error(`No such event; saw ${JSON.stringify(events)}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe.skipIf(!bitcoind)('ZMQ notifications (real bitcoind)', () => {
  let node: RegtestNode;
  let subscriber: ZmqSubscriber;
  const events: ZmqEvent[] = [];

  beforeAll(async () => {
    const port = await freePort();
    const address = `tcp://127.0.0.1:${String(port)}`;
    node = await startRegtestNode(bitcoind ?? '', {
      settings: { zmqpubhashblock: address, zmqpubhashtx: address, zmqpubsequence: address },
    });
    const notifications = await node.client.call<{ type: string; address: string }[]>('getzmqnotifications');
    expect(notifications.map((entry) => entry.type).sort()).toEqual(['pubhashblock', 'pubhashtx', 'pubsequence']);
    subscriber = await subscribeZmq({
      address,
      topics: ['hashblock', 'hashtx', 'sequence'],
      onMessage: (message) => {
        const event = interpretZmqMessage(message);
        if (event) events.push(event);
      },
    });
    // libzmq drops what is published before the subscription reaches it.
    await new Promise((resolve) => setTimeout(resolve, 500));
  }, 120_000);

  afterAll(async () => {
    subscriber.close();
    await node.stop();
    removeTestRoot(node.dataDirectory);
  }, 60_000);

  it('hears of a mined block, by hash and as a connected block', async () => {
    const [hash] = await node.client.call<string[]>('generatetodescriptor', [1, 'raw(51)#8lvh9jxk']);
    expect(await until(events, (event) => event.kind === 'block')).toMatchObject({ kind: 'block', hash });
    expect(
      await until(events, (event) => event.kind === 'mempool' && event.change === 'block-connected'),
    ).toMatchObject({ hash });
  });

  it('hears of a transaction entering the mempool', async () => {
    await node.client.call('createwallet', ['zmq']);
    const address = await node.client.call<string>('getnewaddress', [], { wallet: 'zmq' });
    await node.client.call('generatetoaddress', [101, address]);
    const txid = await node.client.call<string>('sendtoaddress', [address, 1], { wallet: 'zmq' });
    expect(await until(events, (event) => event.kind === 'transaction' && event.txid === txid)).toBeDefined();
    const added = await until(
      events,
      (event) => event.kind === 'mempool' && event.change === 'transaction-added' && event.hash === txid,
    );
    expect(added).toMatchObject({ mempoolSequence: expect.any(Number) as number });
  });

  it('watches the node for the developer tools and hands what arrives over in batches', async () => {
    const published: OrchestratorEvent[] = [];
    const profile = {
      id: 'z',
      name: 'ZMQ node',
      network: 'regtest',
      rpcEndpoint: `http://127.0.0.1:${String(node.rpcPort)}`,
    } as unknown as NodeWithStatus['profile'];
    const watcher = new ZmqWatchService({
      nodes: {
        get: () => ({ profile, status: { nodeId: 'z', state: 'running', checkedAt: '2026-10-23T00:00:00.000Z' } }),
        rpc: () => node.client,
      },
      publish: (event) => published.push(event),
      logger: new StructuredLogger([new MemorySink()], 'debug'),
    });
    const status = await watcher.status('z');
    expect(status).toMatchObject({ watching: false, unavailableReason: null });
    expect(status.notifications).toHaveLength(3);
    expect((await watcher.watch('z', true)).watching).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const [hash] = await node.client.call<string[]>('generatetodescriptor', [1, 'raw(51)#8lvh9jxk']);
    const deadline = Date.now() + 20_000;
    while (!published.some((event) => event.type === 'zmq.events' && event.payload.counts['block'] === 1)) {
      if (Date.now() > deadline) throw new Error(`No batch arrived: ${JSON.stringify(published)}`);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const batch = published.find((event) => event.type === 'zmq.events');
    expect(batch?.type === 'zmq.events' && batch.payload.events.some((event) => event.hash === hash)).toBe(true);
    expect((await watcher.watch('z', false)).watching).toBe(false);
    const last = published.at(-1);
    expect(last?.type === 'zmq.events' ? last.payload.stopped : undefined).toBe('Watching stopped.');
  });
});
