import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { NodeWithStatus } from '@btcortex/contracts';
import { MemorySink, StructuredLogger } from '../logging/logger';
import { TransactionTracker } from './tracker';

const logger = new StructuredLogger([new MemorySink()], 'debug');
const tx = (n: number) => n.toString(16).padStart(64, '0');

/** A chain the tracker can read: blocks with their transactions, a mempool and, optionally, a transaction index. */
class FakeChain {
  blocks: { hash: string; txids: string[] }[] = [];
  mempool = new Set<string>();
  txindex = false;
  private counter = 0;

  constructor(height: number) {
    for (let index = 0; index <= height; index += 1) this.mine([]);
  }

  mine(txids: string[]): void {
    this.counter += 1;
    this.blocks.push({ hash: `b${String(this.counter)}`.padEnd(64, '0'), txids });
    for (const txid of txids) this.mempool.delete(txid);
  }

  /** Replaces the blocks from a height on, as a reorganisation would. */
  reorganiseFrom(height: number): void {
    this.blocks = this.blocks.slice(0, height);
  }

  call<T>(method: string, params: unknown[]): Promise<T> {
    const tip = this.blocks.length - 1;
    const at = (hash: unknown) => this.blocks.findIndex((block) => block.hash === hash);
    switch (method) {
      case 'getblockcount':
        return Promise.resolve(tip as T);
      case 'getblockhash':
        return Promise.resolve(this.blocks[params[0] as number]?.hash as T);
      case 'getblock':
        return Promise.resolve({ tx: this.blocks[at(params[0])]?.txids ?? [] } as T);
      case 'getblockheader': {
        const height = at(params[0]);
        // A block no longer in the chain has -1 confirmations, as Bitcoin Core reports.
        return Promise.resolve(
          (height === -1 ? { confirmations: -1, height: 11 } : { confirmations: tip - height + 1, height }) as T,
        );
      }
      case 'getrawtransaction': {
        const txid = params[0] as string;
        if (this.mempool.has(txid)) return Promise.resolve({} as T);
        const height = this.blocks.findIndex((block) => block.txids.includes(txid));
        if (this.txindex && height !== -1) {
          return Promise.resolve({ blockhash: this.blocks[height]?.hash, confirmations: tip - height + 1 } as T);
        }
        return Promise.reject(new Error('No such mempool transaction. Use -txindex or provide a block hash.'));
      }
    }
    return Promise.reject(new Error(`unexpected ${method}`));
  }
}

function settings() {
  const values = new Map<string, unknown>();
  return {
    get: <T>(key: string, schema: z.ZodType<T>): T | undefined => {
      const value = values.get(key);
      return value === undefined ? undefined : schema.parse(JSON.parse(JSON.stringify(value)));
    },
    set: (key: string, value: unknown) => {
      values.set(key, value);
    },
  };
}

function tracker(chain: FakeChain, store = settings()) {
  const node = { profile: { id: 'n1', network: 'regtest' } } as unknown as NodeWithStatus;
  return new TransactionTracker({
    settings: store,
    nodes: {
      get: () => node,
      rpc: () => ({ call: (method, params) => chain.call(method, Array.isArray(params) ? params : []) }),
    },
    logger,
    now: () => new Date('2026-10-23T12:00:00.000Z'),
  });
}

describe('following transactions until they confirm', () => {
  it('follows a transaction from the mempool into a block, without the transaction index', async () => {
    const chain = new FakeChain(10);
    chain.mempool.add(tx(1));
    const followed = tracker(chain);
    expect(await followed.add('n1', tx(1))).toMatchObject([{ state: 'mempool', confirmations: 0 }]);
    chain.mine([tx(2), tx(1)]);
    await followed.refresh();
    expect(followed.list()).toMatchObject([{ state: 'confirmed', blockHeight: 11, confirmations: 1 }]);
    chain.mine([]);
    chain.mine([]);
    await followed.refresh();
    expect(followed.list()[0]?.confirmations).toBe(3);
  });

  it('uses the transaction index when the node has one, even for older blocks', async () => {
    const chain = new FakeChain(20);
    chain.txindex = true;
    chain.blocks[3]?.txids.push(tx(5));
    const followed = tracker(chain);
    expect(await followed.add('n1', tx(5))).toMatchObject([{ state: 'confirmed', blockHeight: 3, confirmations: 18 }]);
  });

  it('notices a block reorganised away and finds the transaction again', async () => {
    const chain = new FakeChain(10);
    chain.mempool.add(tx(1));
    const followed = tracker(chain);
    await followed.add('n1', tx(1));
    chain.mine([tx(1)]);
    await followed.refresh();
    expect(followed.list()[0]).toMatchObject({ state: 'confirmed', blockHeight: 11 });

    chain.reorganiseFrom(11);
    chain.mine([]);
    chain.mempool.add(tx(1));
    await followed.refresh();
    expect(followed.list()[0]).toMatchObject({ state: 'mempool', blockHash: null, blockHeight: null });

    chain.mine([tx(1)]);
    await followed.refresh();
    expect(followed.list()[0]).toMatchObject({ state: 'confirmed', blockHeight: 12, confirmations: 1 });
  });

  it('says when a transaction left the mempool unmined, and remembers what it follows across restarts', async () => {
    const chain = new FakeChain(10);
    chain.mempool.add(tx(7));
    const store = settings();
    const followed = tracker(chain, store);
    await followed.add('n1', tx(7));
    // Replaced or expired: gone from the mempool and in no block.
    chain.mempool.delete(tx(7));
    chain.mine([]);
    await followed.refresh();
    expect(followed.list()[0]?.state).toBe('missing');

    const restarted = tracker(chain, store);
    expect(restarted.list()).toMatchObject([{ txid: tx(7), state: 'missing' }]);
    expect(restarted.remove('n1', tx(7))).toEqual([]);
    expect(tracker(chain, store).list()).toEqual([]);
  });
});
