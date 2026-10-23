import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { BitcoinConfig, effectiveScalar, resolveEffective, setOption } from '@btcortex/bitcoin-config';
import type { BitcoinNetwork } from '@btcortex/bitcoin-config';
import { BitcoinRpcError } from '@btcortex/bitcoin-rpc';
import { AppFailure } from '@btcortex/contracts';
import type {
  AppError,
  NodeProfile,
  NodeSignerStatus,
  PsbtReview,
  SignedPsbt,
  SignerAddressType,
  SignerWalletDetail,
  SignerWalletSummary,
  WalletTransaction,
} from '@btcortex/contracts';
import type { HardwareService } from '../hardware/hardware-service';
import type { Logger } from '../logging/logger';
import type { NodeConfigService } from './config-service';
import { describeNodeError, nodeComponent } from './node-errors';
import type { NodeManager } from './node-manager';

// Hardware wallets on the user's own node (specification section 9: watch-only
// operation, descriptor import, PSBT import and export), through Bitcoin
// Core's external signer support with BTCortex's verified HWI as the signer
// (bitcoin/doc/external-signer.md). Bitcoin Core then creates a watch-only
// wallet from the device's public descriptors, shows addresses on the device
// and asks the device to sign; private keys never leave it. Signing and
// broadcasting each need their own explicit request, and the device asks for
// confirmation itself. Only wallets bound to a device are shown here.

const SIGNER_TIMEOUT_MS = 10 * 60_000;
const MAX_PSBT_FILE_BYTES = 4 * 1024 * 1024;
const PSBT_MAGIC = Buffer.from([0x70, 0x73, 0x62, 0x74, 0xff]);
const ADDRESS_TYPES: Record<string, SignerAddressType> = {
  pkh: 'legacy',
  sh: 'p2sh-segwit',
  wpkh: 'bech32',
  tr: 'bech32m',
};

export interface SignerServiceOptions {
  nodes: Pick<NodeManager, 'list' | 'get' | 'rpc' | 'restart' | 'appliedConfig'>;
  config: Pick<NodeConfigService, 'get' | 'save'>;
  hardware: Pick<HardwareService, 'hwi'>;
  /** Where BTCortex keeps its HWI versions; a signer setting under it is BTCortex's own. */
  hwiDirectory: string;
  logger: Logger;
}

function sats(btc: unknown): number {
  return typeof btc === 'number' ? Math.round(btc * 100_000_000) : 0;
}

function btcString(amountSats: number): string {
  return (amountSats / 100_000_000).toFixed(8);
}

/** The signer setting as Bitcoin Core runs it: the quotes keep a path with spaces in one piece. */
export function signerSetting(executable: string): string {
  return `"${executable}"`;
}

function unquote(value: string): string {
  return value.trim().replace(/^"(.*)"$/, '$1');
}

/** The effective `signer` value for the node's network, without quotes. */
export function configuredSigner(text: string, network: BitcoinNetwork): string | undefined {
  const value = effectiveScalar(resolveEffective(BitcoinConfig.parse(text), network), 'signer');
  return value === undefined || value.trim() === '' ? undefined : unquote(value);
}

/** The PSBT in base64, from a file holding it in binary or as text (base64 or hex). */
export function psbtFromFile(data: Buffer): string {
  if (data.subarray(0, PSBT_MAGIC.length).equals(PSBT_MAGIC)) return data.toString('base64');
  const text = data.toString('utf8').trim();
  if (/^[0-9a-fA-F]+$/.test(text) && text.toLowerCase().startsWith('70736274ff')) {
    return Buffer.from(text, 'hex').toString('base64');
  }
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(text) && Buffer.from(text, 'base64').subarray(0, 5).equals(PSBT_MAGIC)) return text;
  throw new AppFailure({
    code: 'psbt.unreadable',
    message: 'The file does not contain a PSBT.',
    component: 'PSBT',
    dataRisk: 'none',
    recoveryActions: [],
  });
}

export class SignerService {
  constructor(private readonly options: SignerServiceOptions) {}

  private failure(profile: NodeProfile, error: Pick<AppError, 'code' | 'message'> & Partial<AppError>): AppFailure {
    return new AppFailure({ component: nodeComponent(profile), dataRisk: 'none', recoveryActions: [], ...error });
  }

  /** A signer inside BTCortex's own HWI folder is one BTCortex set; anything else is the user's own. */
  private isBtcortexHwi(value: string | undefined): boolean {
    if (value === undefined) return false;
    return resolve(value)
      .toLowerCase()
      .startsWith(`${resolve(this.options.hwiDirectory).toLowerCase()}\\`);
  }

  /** Translates Bitcoin Core's wallet and signer errors. */
  private describe(profile: NodeProfile, error: unknown): AppFailure {
    if (error instanceof AppFailure) return error;
    if (error instanceof BitcoinRpcError) {
      const text = error.message;
      if (/No external signers found/i.test(text)) {
        return this.failure(profile, {
          code: 'signer.none',
          message: 'No hardware wallet was found.',
          likelyCause:
            'Connect the hardware wallet, unlock it, and close Trezor Suite or any other application using it.',
          recoveryActions: [{ id: 'retry', label: 'Try again' }],
        });
      }
      if (/More than one external signer/i.test(text)) {
        return this.failure(profile, {
          code: 'signer.several',
          message: 'More than one hardware wallet is connected.',
          likelyCause: 'Bitcoin Core works with one device at a time. Disconnect the others.',
        });
      }
      if (/Signer echoed unexpected address/i.test(text)) {
        return this.failure(profile, {
          code: 'signer.address-mismatch',
          message: 'The hardware wallet showed a different address. Do not use this address.',
          likelyCause: 'The device does not hold the keys of this wallet, or something altered the address.',
        });
      }
      if (/External signer|signer/i.test(text)) {
        return this.failure(profile, {
          code: 'signer.failed',
          message: `The hardware wallet did not complete the request: ${text}`,
          likelyCause: 'The request was declined or timed out on the device, or the device was disconnected.',
          recoveryActions: [{ id: 'retry', label: 'Try again' }],
        });
      }
      if (error.code === -32601 && /wallet|signer/i.test(error.method)) {
        return this.failure(profile, {
          code: 'signer.unavailable',
          message:
            'This node runs without its wallet functions (disablewallet), so it cannot hold a hardware-wallet wallet.',
        });
      }
    }
    return new AppFailure(describeNodeError(profile, error));
  }

  private requireRunning(nodeId: string): NodeProfile {
    const { profile, status } = this.options.nodes.get(nodeId);
    if (status.state !== 'running') {
      throw this.failure(profile, {
        code: 'nodes.not-running',
        message: 'Start the node first.',
        recoveryActions: [{ id: 'start-node', label: 'Start the node' }],
      });
    }
    return profile;
  }

  private async requireSignerWallet(nodeId: string, profile: NodeProfile, wallet: string): Promise<void> {
    const info = await this.options.nodes
      .rpc(nodeId)
      .call<{ external_signer?: boolean }>('getwalletinfo', [], { wallet });
    if (info.external_signer !== true) {
      throw this.failure(profile, {
        code: 'signer.not-hardware-wallet',
        message: `${wallet} is not a hardware-wallet wallet, so BTCortex does not use it.`,
      });
    }
  }

  private async summary(nodeId: string, wallet: string): Promise<SignerWalletSummary> {
    const client = this.options.nodes.rpc(nodeId);
    const [balances, descriptors] = await Promise.all([
      client.call<{ mine?: { trusted?: number; untrusted_pending?: number; immature?: number } }>('getbalances', [], {
        wallet,
      }),
      client.call<{ descriptors?: { desc?: string }[] }>('listdescriptors', [], { wallet }),
    ]);
    const origin = /\[([0-9a-f]{8})\//.exec(descriptors.descriptors?.[0]?.desc ?? '');
    return {
      name: wallet,
      fingerprint: origin?.[1] ?? null,
      balanceSats: sats(balances.mine?.trusted),
      pendingSats: sats(balances.mine?.untrusted_pending),
      immatureSats: sats(balances.mine?.immature),
    };
  }

  async status(nodeId: string): Promise<NodeSignerStatus> {
    const node = this.options.nodes.get(nodeId);
    const { profile } = node;
    const running = node.status.state === 'running';
    const document = await this.options.config.get(nodeId);
    const signer = configuredSigner(document.text, profile.network);
    const configured = this.isBtcortexHwi(signer);
    const applied = this.options.nodes.appliedConfig(nodeId);
    const restartRequired = running && applied !== undefined && configuredSigner(applied, profile.network) !== signer;

    let readOnlyReason: string | undefined;
    if (profile.execution !== 'managed') {
      readOnlyReason =
        'BTCortex sets up hardware wallets only on nodes it set up. Existing installations stay as they are.';
    } else if (!document.editable) {
      readOnlyReason = document.readOnlyReason ?? 'This node’s configuration cannot be changed from BTCortex.';
    }

    let signers: NodeSignerStatus['signers'] = null;
    const wallets: SignerWalletSummary[] = [];
    let walletUnavailableReason: string | undefined;
    if (running) {
      const client = this.options.nodes.rpc(nodeId);
      if (configured && !restartRequired) {
        try {
          const found = await client.call<{ signers?: { fingerprint?: string; name?: string }[] }>(
            'enumeratesigners',
            [],
            { timeoutMs: 90_000 },
          );
          signers = (found.signers ?? []).flatMap((entry) =>
            typeof entry.fingerprint === 'string' ? [{ fingerprint: entry.fingerprint, name: entry.name ?? '' }] : [],
          );
        } catch (error) {
          this.options.logger.debug('enumeratesigners failed', { nodeId, error });
          signers = [];
        }
      }
      try {
        const names = await client.call<string[]>('listwallets');
        for (const name of names) {
          const info = await client.call<{ external_signer?: boolean }>('getwalletinfo', [], { wallet: name });
          if (info.external_signer === true) wallets.push(await this.summary(nodeId, name));
        }
      } catch (error) {
        walletUnavailableReason =
          error instanceof BitcoinRpcError && error.code === -32601
            ? 'This node runs without its wallet functions (disablewallet).'
            : 'The node’s wallets could not be read.';
      }
    }
    return {
      manageable: readOnlyReason === undefined,
      ...(readOnlyReason === undefined ? {} : { readOnlyReason }),
      configured,
      restartRequired,
      running,
      signers,
      wallets,
      ...(walletUnavailableReason === undefined ? {} : { walletUnavailableReason }),
    };
  }

  /** Nodes whose configuration runs this HWI version as their signer. */
  async usersOf(version: string): Promise<{ id: string; name: string }[]> {
    const target = resolve(join(this.options.hwiDirectory, version, 'hwi.exe')).toLowerCase();
    const users: { id: string; name: string }[] = [];
    for (const { profile } of this.options.nodes.list()) {
      const document = await this.options.config.get(profile.id).catch(() => undefined);
      const value = document ? configuredSigner(document.text, profile.network) : undefined;
      if (value !== undefined && resolve(value).toLowerCase() === target)
        users.push({ id: profile.id, name: profile.name });
    }
    return users;
  }

  /** Points the node at BTCortex's newest verified HWI and restarts it. */
  async enable(nodeId: string): Promise<{ restarting: boolean }> {
    const node = this.options.nodes.get(nodeId);
    const { profile } = node;
    if (profile.execution !== 'managed') {
      throw this.failure(profile, {
        code: 'signer.not-managed',
        message: 'BTCortex sets up hardware wallets only on nodes it set up. Existing installations stay as they are.',
      });
    }
    const hwi = await this.options.hardware.hwi();
    if (!hwi) {
      throw this.failure(profile, {
        code: 'hardware.hwi-missing',
        message: 'Install HWI first; the node then uses it to talk to hardware wallets.',
        recoveryActions: [{ id: 'install-hwi', label: 'Install HWI' }],
      });
    }
    const document = await this.options.config.get(nodeId);
    if (!document.editable) {
      throw this.failure(profile, {
        code: 'config.read-only',
        message: document.readOnlyReason ?? 'This configuration cannot be changed from BTCortex.',
      });
    }
    const text = setOption(document.text, 'signer', [signerSetting(hwi.executable)], profile.network);
    const saved = await this.options.config.save(nodeId, {
      text,
      revision: document.revision,
      // Confirmed by the user: the node runs BTCortex's verified HWI to reach the device.
      acceptedRisks: ['signer'],
    });
    const running = node.status.state === 'running' || node.status.state === 'starting';
    const restarting = running && saved.changedKeys.length > 0;
    if (restarting) await this.options.nodes.restart(nodeId);
    this.options.logger.info('Set up hardware wallets on a node', { nodeId, hwi: hwi.version, restarting });
    return { restarting };
  }

  /** A watch-only wallet for the one connected device, from its public descriptors. */
  async createWallet(nodeId: string, name: string): Promise<{ wallet: string }> {
    const profile = this.requireRunning(nodeId);
    try {
      const created = await this.options.nodes.rpc(nodeId).call<{ name: string }>(
        'createwallet',
        {
          wallet_name: name,
          disable_private_keys: true,
          blank: false,
          passphrase: '',
          avoid_reuse: false,
          descriptors: true,
          load_on_startup: true,
          external_signer: true,
        },
        { timeoutMs: SIGNER_TIMEOUT_MS },
      );
      this.options.logger.info('Created a hardware-wallet wallet', { nodeId });
      return { wallet: created.name };
    } catch (error) {
      throw this.describe(profile, error);
    }
  }

  async detail(nodeId: string, wallet: string): Promise<SignerWalletDetail> {
    const profile = this.requireRunning(nodeId);
    try {
      await this.requireSignerWallet(nodeId, profile, wallet);
      const client = this.options.nodes.rpc(nodeId);
      const [summary, descriptors, history, chain] = await Promise.all([
        this.summary(nodeId, wallet),
        client.call<{ descriptors?: { desc?: string; active?: boolean; internal?: boolean }[] }>(
          'listdescriptors',
          [],
          {
            wallet,
          },
        ),
        client.call<
          {
            txid?: string;
            amount?: number;
            fee?: number;
            confirmations?: number;
            time?: number;
            address?: string;
            category?: string;
          }[]
        >('listtransactions', ['*', 50, 0, true], { wallet }),
        client.getBlockchainInfo(),
      ]);
      const addressTypes = [
        ...new Set(
          (descriptors.descriptors ?? [])
            .filter((entry) => entry.active === true && entry.internal !== true)
            .flatMap((entry) => {
              const type = ADDRESS_TYPES[(entry.desc ?? '').split('(')[0] ?? ''];
              return type ? [type] : [];
            }),
        ),
      ];
      const transactions: WalletTransaction[] = history
        .filter((entry) => typeof entry.txid === 'string')
        .reverse()
        .map((entry) => ({
          txid: entry.txid ?? '',
          amountSats: sats(entry.amount) + sats(entry.fee),
          confirmations: entry.confirmations ?? 0,
          time: new Date((entry.time ?? 0) * 1000).toISOString(),
          ...(entry.address ? { address: entry.address } : {}),
          category: entry.category ?? 'unknown',
        }));
      return { ...summary, addressTypes, transactions, pruned: chain.pruned };
    } catch (error) {
      throw this.describe(profile, error);
    }
  }

  async newAddress(nodeId: string, wallet: string, type: SignerAddressType): Promise<string> {
    const profile = this.requireRunning(nodeId);
    try {
      await this.requireSignerWallet(nodeId, profile, wallet);
      return await this.options.nodes.rpc(nodeId).call<string>('getnewaddress', ['', type], { wallet });
    } catch (error) {
      throw this.describe(profile, error);
    }
  }

  /** Bitcoin Core asks the device to show the address and refuses one the device does not echo back. */
  async displayAddress(nodeId: string, wallet: string, address: string): Promise<void> {
    const profile = this.requireRunning(nodeId);
    try {
      await this.requireSignerWallet(nodeId, profile, wallet);
      await this.options.nodes
        .rpc(nodeId)
        .call('walletdisplayaddress', [address], { wallet, timeoutMs: SIGNER_TIMEOUT_MS });
    } catch (error) {
      throw this.describe(profile, error);
    }
  }

  private async review(nodeId: string, psbt: string, wallet?: string): Promise<PsbtReview> {
    const client = this.options.nodes.rpc(nodeId);
    const [decoded, analysis] = await Promise.all([
      client.call<{
        tx?: {
          vin?: { txid?: string; vout?: number }[];
          vout?: { value?: number; scriptPubKey?: { address?: string } }[];
        };
        inputs?: {
          witness_utxo?: { amount?: number; scriptPubKey?: { address?: string } };
          non_witness_utxo?: { vout?: { value?: number; scriptPubKey?: { address?: string } }[] };
        }[];
        fee?: number;
      }>('decodepsbt', [psbt]),
      client.call<{ estimated_vsize?: number; estimated_feerate?: number; fee?: number; next?: string }>(
        'analyzepsbt',
        [psbt],
      ),
    ]);
    const vin = decoded.tx?.vin ?? [];
    const inputs = vin.map((input, index) => {
      const data = decoded.inputs?.[index];
      const spent = data?.witness_utxo ?? data?.non_witness_utxo?.vout?.[input.vout ?? 0];
      const amount = data?.witness_utxo?.amount ?? data?.non_witness_utxo?.vout?.[input.vout ?? 0]?.value;
      return {
        txid: input.txid ?? '',
        vout: input.vout ?? 0,
        amountSats: amount === undefined ? null : sats(amount),
        address: spent?.scriptPubKey?.address ?? null,
      };
    });
    const outputs = [];
    for (const output of decoded.tx?.vout ?? []) {
      const address = output.scriptPubKey?.address ?? null;
      let ownedByWallet = false;
      if (wallet !== undefined && address !== null) {
        const info = await client.call<{ ismine?: boolean }>('getaddressinfo', [address], { wallet }).catch(() => ({}));
        ownedByWallet = 'ismine' in info && info.ismine;
      }
      outputs.push({ address, amountSats: sats(output.value), ownedByWallet });
    }
    const fee = analysis.fee ?? decoded.fee;
    return {
      psbt,
      inputs,
      outputs,
      feeSats: fee === undefined ? null : sats(fee),
      // analyzepsbt reports BTC per kvB; 1 BTC/kvB is 100 000 sat/vB.
      feeRateSatPerVb: analysis.estimated_feerate === undefined ? null : analysis.estimated_feerate * 100_000,
      estimatedVsize: analysis.estimated_vsize ?? null,
      next: analysis.next ?? null,
      complete: analysis.next === 'extractor',
    };
  }

  async createPsbt(
    nodeId: string,
    wallet: string,
    outputs: readonly { address: string; amountSats: number }[],
    feeRateSatPerVb: number,
  ): Promise<PsbtReview> {
    const profile = this.requireRunning(nodeId);
    try {
      await this.requireSignerWallet(nodeId, profile, wallet);
      const client = this.options.nodes.rpc(nodeId);
      for (const output of outputs) {
        const valid = await client.call<{ isvalid?: boolean }>('validateaddress', [output.address]);
        if (valid.isvalid !== true) {
          throw this.failure(profile, {
            code: 'psbt.invalid-address',
            message: `${output.address} is not a valid address on this node’s network.`,
          });
        }
      }
      const funded = await client.call<{ psbt: string }>(
        'walletcreatefundedpsbt',
        [
          [],
          outputs.map((output) => ({ [output.address]: btcString(output.amountSats) })),
          0,
          { fee_rate: feeRateSatPerVb, replaceable: true },
          true,
        ],
        { wallet },
      );
      return await this.review(nodeId, funded.psbt, wallet);
    } catch (error) {
      throw this.describe(profile, error);
    }
  }

  async decodePsbt(nodeId: string, psbt: string, wallet?: string): Promise<PsbtReview> {
    const profile = this.requireRunning(nodeId);
    try {
      if (wallet !== undefined) await this.requireSignerWallet(nodeId, profile, wallet);
      return await this.review(nodeId, psbt, wallet);
    } catch (error) {
      throw this.describe(profile, error);
    }
  }

  /** Only after the user reviewed the PSBT and asked for it; the device asks for confirmation itself. */
  async signPsbt(nodeId: string, wallet: string, psbt: string): Promise<SignedPsbt> {
    const profile = this.requireRunning(nodeId);
    try {
      await this.requireSignerWallet(nodeId, profile, wallet);
      const client = this.options.nodes.rpc(nodeId);
      this.options.logger.info('Asked a hardware wallet to sign a transaction', { nodeId });
      const processed = await client.call<{ psbt: string; complete: boolean; hex?: string }>(
        'walletprocesspsbt',
        [psbt, true, 'DEFAULT', true, true],
        { wallet, timeoutMs: SIGNER_TIMEOUT_MS },
      );
      let hex = processed.hex ?? null;
      if (processed.complete && hex === null) {
        const finalised = await client.call<{ hex?: string; complete?: boolean }>('finalizepsbt', [processed.psbt]);
        hex = finalised.complete === true ? (finalised.hex ?? null) : null;
      }
      return { review: await this.review(nodeId, processed.psbt, wallet), hex };
    } catch (error) {
      throw this.describe(profile, error);
    }
  }

  /** The final transaction of a PSBT that was signed elsewhere, once every input carries its signatures. */
  async finalizePsbt(nodeId: string, psbt: string): Promise<{ complete: boolean; hex: string | null }> {
    const profile = this.requireRunning(nodeId);
    try {
      const result = await this.options.nodes
        .rpc(nodeId)
        .call<{ complete?: boolean; hex?: string }>('finalizepsbt', [psbt]);
      return { complete: result.complete === true, hex: result.complete === true ? (result.hex ?? null) : null };
    } catch (error) {
      throw this.describe(profile, error);
    }
  }

  async broadcast(nodeId: string, hex: string): Promise<{ txid: string }> {
    const profile = this.requireRunning(nodeId);
    try {
      const txid = await this.options.nodes.rpc(nodeId).call<string>('sendrawtransaction', [hex]);
      this.options.logger.info('Broadcast a transaction', { nodeId });
      return { txid };
    } catch (error) {
      throw this.describe(profile, error);
    }
  }

  async readPsbtFile(path: string): Promise<string> {
    const data = await readFile(path);
    if (data.length > MAX_PSBT_FILE_BYTES) {
      throw new AppFailure({
        code: 'psbt.too-large',
        message: 'The file is too large to be a PSBT.',
        component: 'PSBT',
        dataRisk: 'none',
        recoveryActions: [],
      });
    }
    return psbtFromFile(data);
  }

  /** `.psbt` files hold the PSBT in binary, as devices with microSD slots expect; `.txt` files hold base64. */
  async writePsbtFile(path: string, psbt: string): Promise<void> {
    const extension = extname(path).toLowerCase();
    if (extension !== '.psbt' && extension !== '.txt') {
      throw new AppFailure({
        code: 'psbt.file-type',
        message: 'A PSBT is saved as a .psbt or .txt file.',
        component: 'PSBT',
        dataRisk: 'none',
        recoveryActions: [],
      });
    }
    const binary = Buffer.from(psbt, 'base64');
    if (!binary.subarray(0, PSBT_MAGIC.length).equals(PSBT_MAGIC)) {
      throw new AppFailure({
        code: 'psbt.unreadable',
        message: 'This is not a PSBT.',
        component: 'PSBT',
        dataRisk: 'none',
        recoveryActions: [],
      });
    }
    await writeFile(path, extension === '.psbt' ? binary : `${psbt}\n`);
  }
}
