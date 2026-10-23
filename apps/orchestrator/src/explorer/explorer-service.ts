import { createHash } from 'node:crypto';
import type { Socket } from 'node:net';
import { BitcoinRpcError } from '@btcortex/bitcoin-rpc';
import type { BitcoinRpcClient } from '@btcortex/bitcoin-rpc';
import { AppFailure } from '@btcortex/contracts';
import type {
  AddressDetail,
  AppError,
  BlockDetail,
  BlockTransactionSummary,
  ElectrumConnection,
  ExplorerOverview,
  ExplorerSearchResult,
  NodeProfile,
  RawTransactionCheck,
  ScriptSummary,
  TransactionDetail,
  TransactionInput,
  TransactionOutput,
} from '@btcortex/contracts';
import { readScripthash } from '@btcortex/integration-fulcrum';
import type { z } from 'zod';
import type { Logger } from '../logging/logger';
import { nodeComponent } from '../nodes/node-errors';
import type { NodeManager } from '../nodes/node-manager';
import {
  BlockShape,
  BlockStatsShape,
  ChainTxStatsShape,
  DecodedScriptShape,
  HeaderShape,
  MempoolAcceptShape,
  MempoolEntryShape,
  MempoolInfoShape,
  RecentBlockStatsShape,
  SmartFeeShape,
  TransactionShape,
  TxOutShape,
  ValidateAddressShape,
} from './rpc-shapes';
import type { InputRaw, MempoolEntryRaw, ScriptPubKeyRaw, TransactionRaw } from './rpc-shapes';

// BTCortex's block explorer (specification section 12). Everything comes
// from the user's own node: blocks and transactions through its RPC
// interface, and address histories through its own Electrum server, because
// Bitcoin Core keeps no index of addresses. What the node cannot answer is
// said plainly: pruned blocks, confirmed transactions without the
// transaction index, addresses without an Electrum server.

const PAGE_SIZE = 25;
const RECENT_BLOCKS = 10;
const CACHE_LIMIT = 200;
const HISTORY_LIMIT = 500;
const FINAL_SEQUENCE_FOR_RBF = 0xfffffffe;

export interface ExplorerServiceOptions {
  nodes: Pick<NodeManager, 'get' | 'rpc'>;
  /** The node's Electrum server, when it serves wallets. */
  electrum: (nodeId: string) => { connection: ElectrumConnection; ready: boolean } | undefined;
  /** An Electrum server on another computer added for the node, while it answers. */
  remoteElectrum?: (nodeId: string) => { name: string; open: () => Promise<Socket> } | undefined;
  logger: Logger;
}

/** Bitcoin amounts as Bitcoin Core writes them, in satoshis. */
export function sats(btc: number): number {
  return Math.round(btc * 100_000_000);
}

/** BTC per 1000 virtual bytes, as Bitcoin Core reports fee rates, in sat/vB. */
export function satPerVbyte(btcPerKvB: number): number {
  return Math.round(btcPerKvB * 100_000 * 100) / 100;
}

/** Electrum's key for a script: the SHA-256 of its bytes, reversed. */
export function scripthashOf(scriptHex: string): string {
  return Buffer.from(createHash('sha256').update(Buffer.from(scriptHex, 'hex')).digest())
    .reverse()
    .toString('hex');
}

/** Runs of readable text in a coinbase input, such as a mining pool's tag. */
export function coinbaseText(coinbaseHex: string): string | null {
  const runs = Buffer.from(coinbaseHex, 'hex')
    .toString('latin1')
    .split(/[^\x20-\x7e]+/)
    .map((run) => run.trim())
    .filter((run) => run.length >= 4);
  return runs.length > 0 ? runs.join(' ') : null;
}

function script(raw: ScriptPubKeyRaw): ScriptSummary {
  return {
    hex: raw.hex,
    asm: raw.asm,
    type: raw.type,
    ...(raw.address === undefined ? {} : { address: raw.address }),
    ...(raw.desc === undefined ? {} : { descriptor: raw.desc }),
  };
}

/** What a block holds, kept for the blocks looked at last: blocks never change once found. */
interface BlockContent {
  transactions: BlockTransactionSummary[];
  sizeBytes: number;
  strippedSizeBytes: number;
  weight: number;
  coinbaseText: string | null;
}

class Lru<V> {
  private readonly values = new Map<string, V>();

  get(key: string): V | undefined {
    const value = this.values.get(key);
    if (value !== undefined) {
      this.values.delete(key);
      this.values.set(key, value);
    }
    return value;
  }

  set(key: string, value: V): void {
    this.values.delete(key);
    this.values.set(key, value);
    if (this.values.size > CACHE_LIMIT) {
      const oldest = this.values.keys().next().value;
      if (oldest !== undefined) this.values.delete(oldest);
    }
  }
}

export class ExplorerService {
  private readonly recentBlocks = new Lru<ExplorerOverview['recentBlocks'][number]>();
  private readonly blockContents = new Lru<BlockContent>();

  constructor(private readonly options: ExplorerServiceOptions) {}

  private failure(profile: NodeProfile, error: Pick<AppError, 'code' | 'message'> & Partial<AppError>): AppFailure {
    return new AppFailure({ component: nodeComponent(profile), dataRisk: 'none', recoveryActions: [], ...error });
  }

  private context(nodeId: string): { profile: NodeProfile; rpc: BitcoinRpcClient } {
    const { profile } = this.options.nodes.get(nodeId);
    return { profile, rpc: this.options.nodes.rpc(nodeId) };
  }

  private call<T>(rpc: BitcoinRpcClient, method: string, params: unknown[], schema: z.ZodType<T>): Promise<T> {
    return rpc.call(method, params, { schema });
  }

  private async optional<T>(work: () => Promise<T>): Promise<T | undefined> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof BitcoinRpcError) return undefined;
      throw error;
    }
  }

  private async transactionIndex(rpc: BitcoinRpcClient): Promise<boolean> {
    const info = await this.optional(() => rpc.getIndexInfo());
    return info?.['txindex']?.synced === true;
  }

  // Overview

  async overview(nodeId: string): Promise<ExplorerOverview> {
    const { profile, rpc } = this.context(nodeId);
    const chain = await rpc.getBlockchainInfo();
    const [hashRate, chainTx, txindex, mempool, ...estimates] = await Promise.all([
      this.optional(() => rpc.call<number>('getnetworkhashps', [120])),
      this.optional(() => this.call(rpc, 'getchaintxstats', [], ChainTxStatsShape)),
      this.transactionIndex(rpc),
      this.call(rpc, 'getmempoolinfo', [], MempoolInfoShape),
      ...[1, 3, 6, 144].map((target) =>
        this.optional(() => this.call(rpc, 'estimatesmartfee', [target], SmartFeeShape)),
      ),
    ]);
    const estimate = (index: number) => {
      const feerate = estimates[index]?.feerate;
      return feerate === undefined ? null : satPerVbyte(feerate);
    };
    const recentBlocks: ExplorerOverview['recentBlocks'] = [];
    for (let height = chain.blocks; height >= 0 && height > chain.blocks - RECENT_BLOCKS; height -= 1) {
      const hash = await rpc.call<string>('getblockhash', [height]);
      let summary = this.recentBlocks.get(hash);
      if (!summary) {
        const header = await this.call(rpc, 'getblockheader', [hash], HeaderShape);
        const stats = await this.optional(() =>
          this.call(rpc, 'getblockstats', [hash, ['feerate_percentiles', 'total_size']], RecentBlockStatsShape),
        );
        summary = {
          hash,
          height,
          time: header.time,
          transactionCount: header.nTx,
          sizeBytes: stats?.total_size ?? 0,
          medianFeeRate: stats ? (stats.feerate_percentiles[2] ?? null) : null,
        };
        this.recentBlocks.set(hash, summary);
      }
      recentBlocks.push(summary);
    }
    const electrum = this.options.electrum(profile.id);
    return {
      chain: chain.chain,
      height: chain.blocks,
      bestBlockHash: chain.bestblockhash,
      difficulty: chain.difficulty,
      networkHashRate: hashRate ?? null,
      transactions: chainTx ? { count: chainTx.txcount, perSecond: chainTx.txrate ?? null } : null,
      pruned: chain.pruned,
      pruneHeight: chain.pruned ? (chain.pruneheight ?? null) : null,
      transactionIndex: txindex,
      addressLookups: electrum?.ready === true || this.options.remoteElectrum?.(profile.id) !== undefined,
      feeEstimates: { nextBlock: estimate(0), halfHour: estimate(1), hour: estimate(2), day: estimate(3) },
      mempool: {
        transactions: mempool.size,
        vsize: mempool.bytes,
        minimumFeeRate: satPerVbyte(mempool.mempoolminfee),
      },
      recentBlocks,
    };
  }

  // Search

  async search(nodeId: string, query: string): Promise<ExplorerSearchResult> {
    const { rpc } = this.context(nodeId);
    const text = query.trim();
    if (/^\d{1,9}$/.test(text)) {
      const hash = await this.optional(() => rpc.call<string>('getblockhash', [Number(text)]));
      return hash
        ? { kind: 'block', id: hash }
        : { kind: 'none', message: `The node has no block at height ${text} yet.` };
    }
    if (/^[0-9a-fA-F]{64}$/.test(text)) {
      const id = text.toLowerCase();
      if (await this.optional(() => this.call(rpc, 'getblockheader', [id], HeaderShape))) return { kind: 'block', id };
      if (await this.optional(() => rpc.call<string>('getrawtransaction', [id, 0]))) {
        return { kind: 'transaction', id };
      }
      return {
        kind: 'none',
        message: (await this.transactionIndex(rpc))
          ? 'The node knows no block or transaction with this id.'
          : 'The node knows no block with this id, and no unconfirmed transaction. Confirmed transactions can be found only with the transaction index, which this node does not keep.',
      };
    }
    const address = await this.optional(() => this.call(rpc, 'validateaddress', [text], ValidateAddressShape));
    if (address?.isvalid) return { kind: 'address', id: address.address ?? text };
    if (/^([0-9a-fA-F]{2})+$/.test(text)) {
      const hex = text.toLowerCase();
      if (await this.optional(() => this.call(rpc, 'decoderawtransaction', [hex], TransactionShape))) {
        return { kind: 'raw-transaction', id: hex };
      }
      if (hex.length <= 20_000) return { kind: 'script', id: hex };
    }
    return {
      kind: 'none',
      message: 'This is not a block height or hash, a transaction id, an address for this network, or hex.',
    };
  }

  // Blocks

  private summarise(transaction: TransactionRaw): BlockTransactionSummary {
    const coinbase = transaction.vin[0]?.coinbase !== undefined;
    const feeSats = transaction.fee === undefined ? (coinbase ? 0 : null) : sats(transaction.fee);
    return {
      txid: transaction.txid,
      vsize: transaction.vsize,
      feeSats: coinbase ? null : feeSats,
      feeRate: coinbase || feeSats === null ? null : Math.round((feeSats / transaction.vsize) * 100) / 100,
      outputSats: transaction.vout.reduce((sum, output) => sum + sats(output.value), 0),
      inputs: transaction.vin.length,
      outputs: transaction.vout.length,
      coinbase,
    };
  }

  async block(nodeId: string, id: string, page: number): Promise<BlockDetail> {
    const { profile, rpc } = this.context(nodeId);
    let hash = id.toLowerCase();
    if (/^\d{1,9}$/.test(id)) {
      const found = await this.optional(() => rpc.call<string>('getblockhash', [Number(id)]));
      if (!found) {
        throw this.failure(profile, {
          code: 'explorer.block-not-found',
          message: `The node has no block at height ${id}.`,
        });
      }
      hash = found;
    }
    const header = await this.optional(() => this.call(rpc, 'getblockheader', [hash], HeaderShape));
    if (!header) {
      throw this.failure(profile, {
        code: 'explorer.block-not-found',
        message: 'The node knows no block with this hash.',
      });
    }
    let content = this.blockContents.get(hash);
    if (!content) {
      try {
        const block = await this.call(rpc, 'getblock', [hash, 2], BlockShape);
        const coinbaseHex = block.coinbase_tx?.coinbase ?? block.tx[0]?.vin[0]?.coinbase;
        content = {
          transactions: block.tx.map((transaction) => this.summarise(transaction)),
          sizeBytes: block.size,
          strippedSizeBytes: block.strippedsize,
          weight: block.weight,
          coinbaseText: coinbaseHex === undefined ? null : coinbaseText(coinbaseHex),
        };
        this.blockContents.set(hash, content);
      } catch (error) {
        // A pruned node keeps the header of every block, but not the block itself.
        if (!(error instanceof BitcoinRpcError)) throw error;
      }
    }
    const stats = content
      ? await this.optional(() => this.call(rpc, 'getblockstats', [hash], BlockStatsShape))
      : undefined;
    const transactions = content?.transactions ?? [];
    const start = page * PAGE_SIZE;
    return {
      hash,
      height: header.height,
      confirmations: header.confirmations,
      time: header.time,
      medianTime: header.mediantime,
      version: header.version,
      versionHex: header.versionHex,
      merkleRoot: header.merkleroot,
      bits: header.bits,
      nonce: header.nonce,
      difficulty: header.difficulty,
      transactionCount: header.nTx,
      sizeBytes: content?.sizeBytes ?? null,
      strippedSizeBytes: content?.strippedSizeBytes ?? null,
      weight: content?.weight ?? null,
      previousHash: header.previousblockhash ?? null,
      nextHash: header.nextblockhash ?? null,
      coinbaseText: content?.coinbaseText ?? null,
      available: content !== undefined,
      stats: stats
        ? {
            subsidySats: stats.subsidy,
            totalFeeSats: stats.totalfee,
            totalOutputSats: stats.total_out,
            feeRatePercentiles: stats.feerate_percentiles,
            averageFeeRate: stats.avgfeerate,
            inputs: stats.ins,
            outputs: stats.outs,
          }
        : null,
      transactions: transactions.slice(start, start + PAGE_SIZE),
      page: { index: page, size: PAGE_SIZE, total: transactions.length },
    };
  }

  // Transactions

  /** The coin an input spends: from the node's answer, the unspent set, or the parent transaction. */
  private async prevout(rpc: BitcoinRpcClient, input: InputRaw): Promise<TransactionInput['prevout']> {
    if (input.prevout) {
      return {
        valueSats: sats(input.prevout.value),
        script: script(input.prevout.scriptPubKey),
        coinbase: input.prevout.generated,
        height: input.prevout.height,
      };
    }
    if (input.txid === undefined || input.vout === undefined) return undefined;
    // Unspent at the tip, whatever the mempool does with it: confirmed coins need no index.
    const coin = await this.optional(() => this.call(rpc, 'gettxout', [input.txid, input.vout, false], TxOutShape));
    if (coin) return { valueSats: sats(coin.value), script: script(coin.scriptPubKey), coinbase: coin.coinbase };
    // A parent in the mempool, or (with the transaction index) one confirmed and spent since.
    const parent = await this.optional(() => this.call(rpc, 'getrawtransaction', [input.txid, 1], TransactionShape));
    const output = parent?.vout.find((candidate) => candidate.n === input.vout);
    return output
      ? {
          valueSats: sats(output.value),
          script: script(output.scriptPubKey),
          coinbase: parent?.vin[0]?.coinbase !== undefined,
        }
      : undefined;
  }

  private async detail(
    rpc: BitcoinRpcClient,
    raw: TransactionRaw,
    entry: MempoolEntryRaw | undefined,
    seen: boolean,
  ): Promise<TransactionDetail> {
    const inputs: TransactionInput[] = [];
    for (const input of raw.vin) {
      const prevout = input.coinbase === undefined ? await this.prevout(rpc, input) : undefined;
      inputs.push({
        ...(input.txid !== undefined && input.vout !== undefined
          ? { previous: { txid: input.txid, vout: input.vout } }
          : {}),
        ...(input.coinbase === undefined ? {} : { coinbase: input.coinbase }),
        sequence: input.sequence,
        ...(input.scriptSig ? { scriptSig: { hex: input.scriptSig.hex, asm: input.scriptSig.asm } } : {}),
        witness: input.txinwitness ?? [],
        ...(prevout ? { prevout } : {}),
      });
    }
    const outputs: TransactionOutput[] = [];
    for (const output of raw.vout) {
      let unspent: boolean | null = null;
      if (seen) {
        const coin = await this.optional(() => this.call(rpc, 'gettxout', [raw.txid, output.n, true], TxOutShape));
        unspent = coin !== undefined ? coin !== null : null;
      }
      outputs.push({ n: output.n, valueSats: sats(output.value), script: script(output.scriptPubKey), unspent });
    }
    const coinbase = raw.vin[0]?.coinbase !== undefined;
    const totalOutputSats = outputs.reduce((sum, output) => sum + output.valueSats, 0);
    const known = inputs.every((input) => input.prevout !== undefined);
    const totalInputSats =
      coinbase || !known ? null : inputs.reduce((sum, input) => sum + (input.prevout?.valueSats ?? 0), 0);
    const feeSats = coinbase
      ? null
      : raw.fee !== undefined
        ? sats(raw.fee)
        : entry
          ? sats(entry.fees.base)
          : totalInputSats !== null
            ? totalInputSats - totalOutputSats
            : null;

    let status: TransactionDetail['status'];
    if (entry) status = { state: 'mempool', firstSeen: entry.time };
    else if (raw.blockhash !== undefined && raw.confirmations !== undefined && raw.confirmations > 0) {
      const header = await this.call(rpc, 'getblockheader', [raw.blockhash], HeaderShape);
      status = {
        state: 'confirmed',
        blockHash: raw.blockhash,
        blockHeight: header.height,
        blockTime: raw.blocktime ?? header.time,
        confirmations: raw.confirmations,
      };
    } else status = { state: 'not-seen' };

    return {
      txid: raw.txid,
      wtxid: raw.hash,
      version: raw.version,
      lockTime: raw.locktime,
      sizeBytes: raw.size,
      vsize: raw.vsize,
      weight: raw.weight,
      segwit: raw.hash !== raw.txid,
      signalsReplaceable: raw.vin.some((input) => input.sequence < FINAL_SEQUENCE_FOR_RBF),
      status,
      feeSats,
      feeRate: feeSats === null ? null : Math.round((feeSats / raw.vsize) * 100) / 100,
      totalInputSats,
      totalOutputSats,
      inputs,
      outputs,
      ...(entry
        ? {
            mempool: {
              ancestorCount: entry.ancestorcount,
              descendantCount: entry.descendantcount,
              depends: entry.depends,
              spentBy: entry.spentby,
              ancestorFeeRate:
                entry.ancestorsize > 0
                  ? Math.round((sats(entry.fees.ancestor) / entry.ancestorsize) * 100) / 100
                  : null,
            },
          }
        : {}),
      hex: raw.hex ?? '',
    };
  }

  async transaction(nodeId: string, txid: string): Promise<TransactionDetail> {
    const { profile, rpc } = this.context(nodeId);
    const id = txid.toLowerCase();
    const entry = await this.optional(() => this.call(rpc, 'getmempoolentry', [id], MempoolEntryShape));
    const raw = await this.optional(() => this.call(rpc, 'getrawtransaction', [id, 2], TransactionShape));
    if (!raw) {
      const txindex = await this.transactionIndex(rpc);
      throw this.failure(profile, {
        code: 'explorer.transaction-not-found',
        message: txindex
          ? 'The node knows no transaction with this id.'
          : 'The node knows no unconfirmed transaction with this id. It keeps no transaction index, so it cannot look up confirmed transactions by id.',
        recoveryActions: txindex ? [] : [{ id: 'open-storage', label: 'Turn on the transaction index' }],
      });
    }
    return this.detail(rpc, raw, entry, true);
  }

  async decodeRaw(nodeId: string, hex: string): Promise<RawTransactionCheck> {
    const { profile, rpc } = this.context(nodeId);
    const decoded = await this.optional(() =>
      this.call(rpc, 'decoderawtransaction', [hex.toLowerCase()], TransactionShape),
    );
    if (!decoded) {
      throw this.failure(profile, {
        code: 'explorer.not-a-transaction',
        message: 'This hex does not decode as a transaction.',
      });
    }
    // A transaction the node already has is shown as it knows it.
    const entry = await this.optional(() => this.call(rpc, 'getmempoolentry', [decoded.txid], MempoolEntryShape));
    const known = await this.optional(() => this.call(rpc, 'getrawtransaction', [decoded.txid, 2], TransactionShape));
    const transaction = await this.detail(
      rpc,
      known ?? { ...decoded, hex: hex.toLowerCase() },
      entry,
      known !== undefined,
    );
    let acceptance: RawTransactionCheck['acceptance'] = null;
    if (!known) {
      const [result] =
        (await this.optional(() => this.call(rpc, 'testmempoolaccept', [[hex.toLowerCase()]], MempoolAcceptShape))) ??
        [];
      if (result) {
        const reason = result['reject-reason'];
        acceptance = { allowed: result.allowed, ...(reason === undefined ? {} : { reason }) };
      }
    }
    return { transaction, acceptance };
  }

  async decodeScript(nodeId: string, hex: string): Promise<ScriptSummary> {
    const { rpc } = this.context(nodeId);
    const decoded = await this.call(rpc, 'decodescript', [hex.toLowerCase()], DecodedScriptShape);
    return {
      hex: hex.toLowerCase(),
      asm: decoded.asm,
      type: decoded.type,
      ...(decoded.address === undefined ? {} : { address: decoded.address }),
      ...(decoded.desc === undefined ? {} : { descriptor: decoded.desc }),
    };
  }

  // Addresses

  async address(nodeId: string, address: string): Promise<AddressDetail> {
    const { profile, rpc } = this.context(nodeId);
    const validated = await this.call(rpc, 'validateaddress', [address.trim()], ValidateAddressShape);
    if (!validated.isvalid || validated.scriptPubKey === undefined) {
      throw this.failure(profile, {
        code: 'explorer.address-invalid',
        message: validated.error ?? 'This is not a valid address for the node’s network.',
      });
    }
    const scriptHex = validated.scriptPubKey;
    const decoded = await this.call(rpc, 'decodescript', [scriptHex], DecodedScriptShape);
    const base = {
      address: validated.address ?? address.trim(),
      script: {
        hex: scriptHex,
        asm: decoded.asm,
        type: decoded.type,
        ...(decoded.desc === undefined ? {} : { descriptor: decoded.desc }),
      },
      scripthash: scripthashOf(scriptHex),
    };
    const electrum = this.options.electrum(profile.id);
    const remote = electrum?.ready ? undefined : this.options.remoteElectrum?.(profile.id);
    if (remote) {
      const summary = await readScripthash({ port: 0, scripthash: base.scripthash, socket: remote.open });
      return {
        ...base,
        source: 'remote-electrum-server',
        sourceName: remote.name,
        balance: summary.balance,
        history: summary.history.slice(-HISTORY_LIMIT).reverse(),
        unspent: summary.unspent,
      };
    }
    if (!electrum?.ready) {
      return {
        ...base,
        source: 'unavailable',
        unavailableReason: electrum
          ? 'The node’s Electrum server is still indexing; address lookups work once it is ready.'
          : 'Bitcoin Core keeps no index of addresses. Set up the node’s Electrum server to look addresses up here, privately.',
        balance: null,
        history: [],
        unspent: [],
      };
    }
    const summary = await readScripthash({ port: electrum.connection.port, scripthash: base.scripthash });
    return {
      ...base,
      source: 'electrum-server',
      balance: summary.balance,
      // Newest first, and only the latest entries of a busy address.
      history: summary.history.slice(-HISTORY_LIMIT).reverse(),
      unspent: summary.unspent,
    };
  }
}
