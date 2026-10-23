import { z } from 'zod';
import type { NodeWithStatus, TrackedTransaction } from '@btcortex/contracts';
import type { BitcoinRpcClient } from '@btcortex/bitcoin-rpc';
import type { Logger } from '../logging/logger';
import type { SettingsStore } from '../persistence/settings';

// Transactions followed until they confirm (specification section 14). A
// transaction is looked up with getrawtransaction, which finds it in the
// mempool and, with the transaction index, in the chain; without the index,
// the blocks that arrived since it was added are searched for it, so no
// index is needed. A block that is reorganised away is searched for again.
// What is followed is kept in the settings, so it survives a restart.

const SETTINGS_KEY = 'devtools.tracked';
const MAX_TRACKED = 50;
const REFRESH_MS = 30_000;
/** Blocks before the one at which following began, in case it confirmed just then. */
const SEARCH_BACK = 6;
/** Blocks searched per check, so a node far ahead catches up over several checks. */
const SEARCH_LIMIT = 144;
/** Deep enough not to be checked any more. */
const SETTLED_CONFIRMATIONS = 100;

const StoredSchema = z.object({
  nodeId: z.string(),
  txid: z.string().regex(/^[0-9a-f]{64}$/),
  addedAt: z.string(),
  state: z.enum(['mempool', 'confirmed', 'missing', 'unknown']),
  confirmations: z.number().int().nonnegative(),
  blockHash: z.string().nullable(),
  blockHeight: z.number().int().nonnegative().nullable(),
  checkedAt: z.string().nullable(),
  searchFrom: z.number().int().nonnegative(),
  searchedThrough: z.number().int().nullable(),
});
type Stored = z.infer<typeof StoredSchema>;

const RawTransactionSchema = z.object({
  blockhash: z.string().optional(),
  confirmations: z.number().optional(),
});
const HeaderSchema = z.object({ confirmations: z.number(), height: z.number() });
const BlockSchema = z.object({ tx: z.array(z.string()) });

export interface TrackerOptions {
  settings: Pick<SettingsStore, 'get' | 'set'>;
  nodes: { get(nodeId: string): NodeWithStatus; rpc(nodeId: string): Pick<BitcoinRpcClient, 'call'> };
  logger: Logger;
  now?: () => Date;
}

function toPublic(entry: Stored): TrackedTransaction {
  return {
    nodeId: entry.nodeId,
    txid: entry.txid,
    addedAt: entry.addedAt,
    state: entry.state,
    confirmations: entry.confirmations,
    blockHash: entry.blockHash,
    blockHeight: entry.blockHeight,
    checkedAt: entry.checkedAt,
  };
}

export class TransactionTracker {
  private entries: Stored[];
  private timer: NodeJS.Timeout | undefined;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly options: TrackerOptions) {
    this.entries = options.settings.get(SETTINGS_KEY, z.array(StoredSchema)) ?? [];
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.refresh();
    }, REFRESH_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  list(): TrackedTransaction[] {
    return this.entries.map(toPublic);
  }

  /** Checks run one after another, so two never search the same blocks at once. */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private save(): void {
    this.options.settings.set(SETTINGS_KEY, this.entries);
  }

  add(nodeId: string, txid: string): Promise<TrackedTransaction[]> {
    return this.serial(async () => {
      let entry = this.entries.find((candidate) => candidate.nodeId === nodeId && candidate.txid === txid);
      if (!entry) {
        const tip = await this.options.nodes.rpc(nodeId).call<number>('getblockcount', []);
        entry = {
          nodeId,
          txid,
          addedAt: this.now().toISOString(),
          state: 'unknown',
          confirmations: 0,
          blockHash: null,
          blockHeight: null,
          checkedAt: null,
          searchFrom: Math.max(0, tip - SEARCH_BACK),
          searchedThrough: null,
        };
        this.entries.unshift(entry);
        // The oldest go first once there are too many, confirmed ones before the others.
        while (this.entries.length > MAX_TRACKED) {
          const index = this.entries.map((candidate) => candidate.state).lastIndexOf('confirmed');
          this.entries.splice(index === -1 ? this.entries.length - 1 : index, 1);
        }
      }
      await this.check(entry);
      this.save();
      return this.list();
    });
  }

  remove(nodeId: string, txid: string): TrackedTransaction[] {
    this.entries = this.entries.filter((entry) => !(entry.nodeId === nodeId && entry.txid === txid));
    this.save();
    return this.list();
  }

  refresh(): Promise<void> {
    return this.serial(async () => {
      const before = JSON.stringify(this.entries);
      for (const entry of this.entries) {
        if (entry.state === 'confirmed' && entry.confirmations >= SETTLED_CONFIRMATIONS) continue;
        try {
          await this.check(entry);
        } catch (error) {
          // A node that is stopped or removed is checked again later.
          this.options.logger.debug('A followed transaction could not be checked', { txid: entry.txid, error });
        }
      }
      if (JSON.stringify(this.entries) !== before) this.save();
    });
  }

  private async check(entry: Stored): Promise<void> {
    const rpc = this.options.nodes.rpc(entry.nodeId);
    const checkedAt = this.now().toISOString();
    const tip = await rpc.call<number>('getblockcount', []);

    if (entry.blockHash !== null) {
      const header = await rpc.call('getblockheader', [entry.blockHash], { schema: HeaderSchema });
      if (header.confirmations > 0) {
        Object.assign(entry, { state: 'confirmed', confirmations: header.confirmations, checkedAt });
        return;
      }
      // Its block left the chain: it may be in the mempool again, or in another block.
      Object.assign(entry, {
        blockHash: null,
        blockHeight: null,
        searchedThrough: Math.max(entry.searchFrom, header.height) - 1,
      });
    }

    const raw = await rpc
      .call('getrawtransaction', [entry.txid, true], { schema: RawTransactionSchema })
      .catch(() => undefined);
    if (raw?.blockhash !== undefined) {
      const header = await rpc.call('getblockheader', [raw.blockhash], { schema: HeaderSchema });
      Object.assign(entry, {
        state: 'confirmed',
        confirmations: Math.max(0, header.confirmations),
        blockHash: raw.blockhash,
        blockHeight: header.height,
        checkedAt,
      });
      return;
    }
    if (raw) {
      // In the mempool, so in none of the blocks so far.
      Object.assign(entry, { state: 'mempool', confirmations: 0, searchedThrough: tip, checkedAt });
      return;
    }

    let height = (entry.searchedThrough ?? entry.searchFrom - 1) + 1;
    const last = Math.min(tip, height + SEARCH_LIMIT - 1);
    for (; height <= last; height += 1) {
      const hash = await rpc.call<string>('getblockhash', [height]);
      const block = await rpc.call('getblock', [hash, 1], { schema: BlockSchema });
      entry.searchedThrough = height;
      if (block.tx.includes(entry.txid)) {
        Object.assign(entry, {
          state: 'confirmed',
          confirmations: tip - height + 1,
          blockHash: hash,
          blockHeight: height,
          checkedAt,
        });
        return;
      }
    }
    // Not in the mempool and not in any block since it was added: replaced, expired or never received.
    Object.assign(entry, { state: last < tip ? 'unknown' : 'missing', confirmations: 0, checkedAt });
  }
}
