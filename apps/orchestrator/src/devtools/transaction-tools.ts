import { z } from 'zod';
import { AppFailure } from '@btcortex/contracts';
import type {
  AddressCheck,
  AddressType,
  BroadcastResult,
  CoinScan,
  CombinedPsbt,
  FinalisedPsbt,
  NodeWithStatus,
  OutputLookup,
  ParsedPaymentUri,
  PaymentUri,
  PaymentUriRequest,
  PsbtAnalysis,
  TrackedTransaction,
} from '@btcortex/contracts';
import type { BitcoinRpcClient } from '@btcortex/bitcoin-rpc';
import { qrMatrix } from '@btcortex/integration-hardware-wallets';
import type { Logger } from '../logging/logger';
import { describeNodeError, nodeComponent } from '../nodes/node-errors';
import { buildPaymentUri, parsePaymentUri } from './bip321';
import { containsPrivateKey, NOT_A_PSBT, psbtBase64 } from './devtools-service';
import type { TransactionTracker } from './tracker';

// Transaction tools that need the node (specification section 14): addresses
// checked with validateaddress, which accepts only the node's own network,
// BIP 321 payment URIs made and read around them, PSBTs combined and
// finalised by the node, and transactions sent — only after the user
// confirmed it — and followed until they confirm. Nothing here signs.

const COMPONENT = 'Developer tools';

const ValidateAddressSchema = z.object({
  isvalid: z.boolean(),
  address: z.string().optional(),
  scriptPubKey: z.string().optional(),
  witness_version: z.number().optional(),
  witness_program: z.string().optional(),
  error: z.string().optional(),
  error_locations: z.array(z.number()).optional(),
});

/** The type of an output script, from its standard templates. */
export function addressType(scriptPubKey: string): AddressType {
  const script = scriptPubKey.toLowerCase();
  if (/^76a914[0-9a-f]{40}88ac$/.test(script)) return 'p2pkh';
  if (/^a914[0-9a-f]{40}87$/.test(script)) return 'p2sh';
  if (/^0014[0-9a-f]{40}$/.test(script)) return 'p2wpkh';
  if (/^0020[0-9a-f]{64}$/.test(script)) return 'p2wsh';
  if (/^5120[0-9a-f]{64}$/.test(script)) return 'p2tr';
  if (script === '51024e73') return 'p2a';
  // Other witness versions and lengths: OP_0 or OP_1–OP_16, then a 2- to 40-byte push.
  const version = Number.parseInt(script.slice(0, 2), 16);
  const length = Number.parseInt(script.slice(2, 4), 16);
  if (
    (version === 0 || (version >= 0x51 && version <= 0x60)) &&
    length >= 2 &&
    length <= 40 &&
    script.length === 4 + length * 2
  ) {
    return 'witness-unknown';
  }
  return 'unknown';
}

const TxOutSchema = z
  .object({
    bestblock: z.string(),
    confirmations: z.number(),
    value: z.number(),
    scriptPubKey: z.object({ hex: z.string(), address: z.string().optional() }),
    coinbase: z.boolean(),
  })
  .nullable();

const ScanSchema = z.object({
  success: z.boolean(),
  height: z.number(),
  bestblock: z.string(),
  unspents: z.array(
    z.object({
      txid: z.string(),
      vout: z.number(),
      scriptPubKey: z.string(),
      desc: z.string(),
      amount: z.number(),
      coinbase: z.boolean(),
      height: z.number(),
    }),
  ),
  total_amount: z.number(),
});

const SmartFeeSchema = z.object({ feerate: z.number().optional() });

/** A scan of the whole UTXO set can take minutes on mainnet. */
const SCAN_TIMEOUT_MS = 10 * 60 * 1000;
const FEE_TARGETS = [2, 6, 144] as const;
/** Shown, and said to be examples, when the node has no estimates yet (always the case on regtest). */
const EXAMPLE_FEE_RATES = [
  { blocks: 2, satPerVb: 20 },
  { blocks: 6, satPerVb: 5 },
  { blocks: 144, satPerVb: 1 },
];

const sats = (btc: number) => Math.round(btc * 100_000_000);

const FinalizedPsbtSchema = z.object({
  psbt: z.string().optional(),
  hex: z.string().optional(),
  complete: z.boolean(),
});

export interface TransactionToolsOptions {
  nodes: { get(nodeId: string): NodeWithStatus; rpc(nodeId: string): Pick<BitcoinRpcClient, 'call'> };
  /** The developer tools' own PSBT analysis. */
  analysePsbt: (nodeId: string, psbt: string) => Promise<PsbtAnalysis>;
  tracker: Pick<TransactionTracker, 'add' | 'remove' | 'list'>;
  logger: Logger;
}

export class TransactionToolsService {
  constructor(private readonly options: TransactionToolsOptions) {}

  private async call<T>(
    nodeId: string,
    method: string,
    params: unknown[],
    schema: z.ZodType<T>,
    timeoutMs?: number,
  ): Promise<T> {
    const { profile } = this.options.nodes.get(nodeId);
    try {
      return await this.options.nodes
        .rpc(nodeId)
        .call<T>(method, params, timeoutMs === undefined ? { schema } : { schema, timeoutMs });
    } catch (error) {
      throw new AppFailure({ ...describeNodeError(profile, error), component: nodeComponent(profile) });
    }
  }

  async address(nodeId: string, address: string): Promise<AddressCheck> {
    const text = address.trim();
    const answer = await this.call(nodeId, 'validateaddress', [text], ValidateAddressSchema);
    if (!answer.isvalid) {
      return {
        address: text,
        valid: false,
        error: answer.error ?? 'The node does not accept this address.',
        errorLocations: answer.error_locations ?? [],
        type: null,
        scriptPubKey: null,
        witnessVersion: null,
        witnessProgram: null,
      };
    }
    const scriptPubKey = answer.scriptPubKey ?? null;
    return {
      address: answer.address ?? text,
      valid: true,
      error: null,
      errorLocations: [],
      type: scriptPubKey === null ? null : addressType(scriptPubKey),
      scriptPubKey,
      witnessVersion: answer.witness_version ?? null,
      witnessProgram: answer.witness_program ?? null,
    };
  }

  async createUri(request: PaymentUriRequest): Promise<PaymentUri> {
    const address = await this.address(request.nodeId, request.address);
    if (!address.valid) {
      throw new AppFailure({
        code: 'devtools.invalid-address',
        message: `The node does not accept this address on its network: ${address.error ?? 'it is not valid'}.`,
        component: COMPONENT,
        dataRisk: 'none',
        recoveryActions: [],
      });
    }
    const uri = buildPaymentUri({
      address: address.address,
      amountSats: request.amountSats,
      label: request.label?.trim(),
      message: request.message?.trim(),
    });
    return { uri, qr: qrMatrix(uri, 'M'), address };
  }

  async readUri(nodeId: string, uri: string): Promise<ParsedPaymentUri> {
    const parsed = parsePaymentUri(uri);
    const addressCheck = parsed.address === null ? null : await this.address(nodeId, parsed.address);
    return { ...parsed, addressCheck };
  }

  private psbt(text: string): string {
    const psbt = psbtBase64(text);
    if (psbt === null) {
      throw new AppFailure({
        code: 'devtools.not-a-psbt',
        message: NOT_A_PSBT,
        component: COMPONENT,
        dataRisk: 'none',
        recoveryActions: [],
      });
    }
    return psbt;
  }

  async combinePsbts(nodeId: string, psbts: readonly string[]): Promise<CombinedPsbt> {
    const combined = await this.call(nodeId, 'combinepsbt', [psbts.map((text) => this.psbt(text))], z.string());
    return { psbt: combined, analysis: await this.options.analysePsbt(nodeId, combined) };
  }

  async finalisePsbt(nodeId: string, psbt: string): Promise<FinalisedPsbt> {
    const answer = await this.call(nodeId, 'finalizepsbt', [this.psbt(psbt), true], FinalizedPsbtSchema);
    return {
      complete: answer.complete,
      psbt: answer.complete ? null : (answer.psbt ?? null),
      hex: answer.complete ? (answer.hex ?? null) : null,
    };
  }

  /** Sends a transaction the user confirmed; Bitcoin Core's own limit on absurd fees stays in force. */
  async broadcast(nodeId: string, hex: string): Promise<BroadcastResult> {
    const { profile } = this.options.nodes.get(nodeId);
    const txid = await this.call(nodeId, 'sendrawtransaction', [hex.toLowerCase()], z.string().regex(/^[0-9a-f]{64}$/));
    this.options.logger.info('Sent a transaction the user confirmed', { nodeId, network: profile.network, txid });
    const tracked = (await this.options.tracker.add(nodeId, txid)).find(
      (entry) => entry.nodeId === nodeId && entry.txid === txid,
    );
    if (!tracked) throw new Error('The transaction was sent but could not be followed.');
    return { txid, tracked };
  }

  async lookupOutput(nodeId: string, txid: string, vout: number): Promise<OutputLookup> {
    const output = await this.call(nodeId, 'gettxout', [txid, vout, true], TxOutSchema);
    if (output === null) {
      return {
        txid,
        vout,
        unspent: false,
        valueSats: null,
        confirmations: null,
        coinbase: null,
        script: null,
        bestBlock: null,
      };
    }
    return {
      txid,
      vout,
      unspent: true,
      valueSats: sats(output.value),
      confirmations: Math.max(0, output.confirmations),
      coinbase: output.coinbase,
      script: {
        hex: output.scriptPubKey.hex,
        type: addressType(output.scriptPubKey.hex),
        address: output.scriptPubKey.address ?? null,
      },
      bestBlock: output.bestblock,
    };
  }

  private failure(code: string, message: string): AppFailure {
    return new AppFailure({ code, message, component: COMPONENT, dataRisk: 'none', recoveryActions: [] });
  }

  /** Every unspent coin of the given addresses and public descriptors, from the node's UTXO set. */
  async scanCoins(nodeId: string, targets: readonly string[]): Promise<CoinScan> {
    const descriptors: string[] = [];
    for (const target of targets) {
      const text = target.trim();
      if (text.includes('(')) {
        if (containsPrivateKey(text)) {
          throw this.failure(
            'devtools.private-key',
            'A descriptor holds a private key. BTCortex never handles private keys: use the public descriptor instead.',
          );
        }
        descriptors.push(text);
        continue;
      }
      const check = await this.address(nodeId, text);
      if (!check.valid)
        throw this.failure(
          'devtools.invalid-address',
          `${text} is not valid on this node’s network: ${check.error ?? ''}`,
        );
      descriptors.push(`addr(${check.address})`);
    }
    const answer = await this.call(nodeId, 'scantxoutset', ['start', descriptors], ScanSchema, SCAN_TIMEOUT_MS);
    if (!answer.success) throw this.failure('devtools.scan-stopped', 'The scan was stopped before it finished.');
    const estimates = await Promise.all(
      FEE_TARGETS.map((blocks) =>
        this.call(nodeId, 'estimatesmartfee', [blocks], SmartFeeSchema).catch(() => ({ feerate: undefined })),
      ),
    );
    const feeRates = estimates.flatMap((estimate, index) =>
      estimate.feerate === undefined
        ? []
        : // estimatesmartfee answers in BTC per kvB; 1 sat/vB is 0.00001 BTC/kvB.
          [{ blocks: FEE_TARGETS[index] ?? 1, satPerVb: Math.round(estimate.feerate * 1e7) / 100 }],
    );
    const estimated = feeRates.length === FEE_TARGETS.length;
    return {
      height: answer.height,
      bestBlock: answer.bestblock,
      coins: answer.unspents.map((coin) => ({
        txid: coin.txid,
        vout: coin.vout,
        valueSats: sats(coin.amount),
        height: coin.height,
        coinbase: coin.coinbase,
        descriptor: coin.desc,
        script: coin.scriptPubKey,
        type: addressType(coin.scriptPubKey),
      })),
      totalSats: sats(answer.total_amount),
      feeRates: estimated ? feeRates : EXAMPLE_FEE_RATES,
      estimated,
    };
  }

  async abortScan(nodeId: string): Promise<{ aborted: boolean }> {
    return { aborted: await this.call(nodeId, 'scantxoutset', ['abort'], z.boolean()) };
  }

  tracked(): TrackedTransaction[] {
    return this.options.tracker.list();
  }

  track(nodeId: string, txid: string): Promise<TrackedTransaction[]> {
    this.options.nodes.get(nodeId);
    return this.options.tracker.add(nodeId, txid);
  }

  untrack(nodeId: string, txid: string): TrackedTransaction[] {
    return this.options.tracker.remove(nodeId, txid);
  }
}
