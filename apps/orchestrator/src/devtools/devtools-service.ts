import { lookup } from 'node:dns/promises';
import { isIP, connect as connectTcp } from 'node:net';
import type { Socket } from 'node:net';
import { connect as connectTls } from 'node:tls';
import type { TLSSocket } from 'node:tls';
import { z } from 'zod';
import { BitcoinConfig, interpretBoolean, resolveEffective } from '@btcortex/bitcoin-config';
import { AppFailure } from '@btcortex/contracts';
import type {
  DescriptorAnalysis,
  MinedBlocks,
  NodeConfigDocument,
  NodeWithStatus,
  ProbeParams,
  ProbeResult,
  ProtocolFeature,
  ProtocolFeatures,
  PsbtAnalysis,
} from '@btcortex/contracts';
import type { BitcoinRpcClient } from '@btcortex/bitcoin-rpc';
import { connectThroughSocks } from '@btcortex/integration-tor';
import type { Logger } from '../logging/logger';
import { describeNodeError, nodeComponent } from '../nodes/node-errors';
import { isOnionHost } from '@btcortex/core';

// Bitcoin developer tools (specification section 15): PSBTs and descriptors
// analysed by the node itself, the protocol features a node supports and what
// kind of rule each is (docs/research/notes/full-nodes-core.md §9), blocks
// generated on regtest, and probes of service endpoints. Descriptors with
// private keys are refused before they reach the node or a log.

const COMPONENT = 'Developer tools';
const MAX_ADDRESSES = 100;
const PROBE_TIMEOUT_MS = 15_000;
const ANSWER_LIMIT = 4096;
const BASE58_TOKEN = /[1-9A-HJ-NP-Za-km-z]+/g;

/** Extended private keys (xprv, tprv and their SLIP-132 cousins) and WIF private keys. */
export function containsPrivateKey(text: string): boolean {
  if (/\b[xyzuvtYZUV]prv[1-9A-HJ-NP-Za-km-z]{60,}/.test(text)) return true;
  return (text.match(BASE58_TOKEN) ?? []).some(
    (token) => (token.length === 51 && /^[59]/.test(token)) || (token.length === 52 && /^[KLc]/.test(token)),
  );
}

export const NOT_A_PSBT =
  'This is not a PSBT: it should be base64 starting with cHNidP, or hexadecimal starting with 70736274ff.';

/** A PSBT as base64, converting hexadecimal ones (with the "psbt" magic); null when it is neither. */
export function psbtBase64(input: string): string | null {
  const text = input.trim();
  const psbt = /^70736274ff[0-9a-f]*$/i.test(text) ? Buffer.from(text, 'hex').toString('base64') : text;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(psbt) && psbt.startsWith('cHNidP') ? psbt : null;
}

const sats = (btc: unknown) => (typeof btc === 'number' ? Math.round(btc * 100_000_000) : null);

const DecodedPsbtSchema = z.object({
  tx: z.object({
    txid: z.string().optional(),
    version: z.number().optional(),
    locktime: z.number().optional(),
    vin: z.array(z.object({ txid: z.string().optional(), vout: z.number().optional() })),
    vout: z.array(
      z.object({
        value: z.number(),
        scriptPubKey: z.object({ hex: z.string().optional(), address: z.string().optional() }).optional(),
      }),
    ),
  }),
  inputs: z.array(
    z.object({
      witness_utxo: z.object({ amount: z.number() }).optional(),
      non_witness_utxo: z.object({ vout: z.array(z.object({ value: z.number() })) }).optional(),
      partial_signatures: z.record(z.string(), z.string()).optional(),
      final_scriptwitness: z.array(z.string()).optional(),
      final_scriptSig: z.unknown().optional(),
    }),
  ),
  fee: z.number().optional(),
});

const AnalysedPsbtSchema = z.object({
  inputs: z
    .array(
      z.object({
        has_utxo: z.boolean(),
        is_final: z.boolean(),
        missing: z
          .object({
            pubkeys: z.array(z.string()).optional(),
            signatures: z.array(z.string()).optional(),
            redeemscript: z.string().optional(),
            witnessscript: z.string().optional(),
          })
          .optional(),
        next: z.string().optional(),
      }),
    )
    .optional(),
  estimated_vsize: z.number().optional(),
  estimated_feerate: z.number().optional(),
  fee: z.number().optional(),
  next: z.string(),
});

const DescriptorInfoSchema = z.object({
  descriptor: z.string(),
  checksum: z.string(),
  isrange: z.boolean(),
  issolvable: z.boolean(),
  hasprivatekeys: z.boolean(),
});

const NetworkInfoSchema = z.object({
  version: z.number(),
  subversion: z.string(),
  localservicesnames: z.array(z.string()).optional(),
});

/** The soft forks getdeploymentinfo names, as people know them. */
const DEPLOYMENT_TITLES: Partial<Record<string, string>> = {
  bip34: 'BIP34: block height in the coinbase',
  bip66: 'BIP66: strict DER signatures',
  bip65: 'BIP65: CHECKLOCKTIMEVERIFY',
  csv: 'Relative lock times (BIP68, BIP112, BIP113)',
  segwit: 'Segregated witness (BIP141, BIP143, BIP147)',
  taproot: 'Taproot and Schnorr signatures (BIP340–342)',
  testdummy: 'Test deployment (testdummy)',
};

const DeploymentInfoSchema = z.object({
  deployments: z.record(z.string(), z.object({ type: z.string(), active: z.boolean(), height: z.number().optional() })),
});

export interface DevToolsServiceOptions {
  nodes: { get(nodeId: string): NodeWithStatus; rpc(nodeId: string): Pick<BitcoinRpcClient, 'call'> };
  config: { get(nodeId: string): Promise<NodeConfigDocument> };
  /** BTCortex's tor's SOCKS port for programs, while it runs. */
  socksPort: () => number | undefined;
  logger: Logger;
}

export class DevToolsService {
  constructor(private readonly options: DevToolsServiceOptions) {}

  private failure(code: string, message: string): AppFailure {
    return new AppFailure({ code, message, component: COMPONENT, dataRisk: 'none', recoveryActions: [] });
  }

  private async call<T>(nodeId: string, method: string, params: unknown[], schema?: z.ZodType<T>): Promise<T> {
    const { profile } = this.options.nodes.get(nodeId);
    try {
      return await this.options.nodes.rpc(nodeId).call<T>(method, params, schema ? { schema } : {});
    } catch (error) {
      throw new AppFailure({ ...describeNodeError(profile, error), component: nodeComponent(profile) });
    }
  }

  // PSBTs

  async psbt(nodeId: string, input: string): Promise<PsbtAnalysis> {
    const psbt = psbtBase64(input);
    if (psbt === null) throw this.failure('devtools.not-a-psbt', NOT_A_PSBT);
    const raw = await this.call<unknown>(nodeId, 'decodepsbt', [psbt]);
    const decoded = DecodedPsbtSchema.parse(raw);
    const analysis = await this.call(nodeId, 'analyzepsbt', [psbt], AnalysedPsbtSchema);
    return {
      txid: decoded.tx.txid ?? null,
      version: decoded.tx.version ?? null,
      locktime: decoded.tx.locktime ?? null,
      inputs: decoded.tx.vin.map((vin, index) => {
        const details = decoded.inputs[index];
        const analysed = analysis.inputs?.[index];
        const previous =
          details?.witness_utxo?.amount ??
          (vin.vout === undefined ? undefined : details?.non_witness_utxo?.vout[vin.vout]?.value);
        const missing = analysed?.missing;
        return {
          outpoint: `${vin.txid ?? '?'}:${String(vin.vout ?? '?')}`,
          amountSats: sats(previous),
          hasUtxo: analysed?.has_utxo ?? previous !== undefined,
          partialSignatures: Object.keys(details?.partial_signatures ?? {}).length,
          final:
            analysed?.is_final ??
            (details?.final_scriptwitness !== undefined || details?.final_scriptSig !== undefined),
          missing: [
            ...(missing?.signatures?.length ? [`${String(missing.signatures.length)} signature(s)`] : []),
            ...(missing?.pubkeys?.length ? [`${String(missing.pubkeys.length)} public key(s)`] : []),
            ...(missing?.redeemscript ? ['the redeem script'] : []),
            ...(missing?.witnessscript ? ['the witness script'] : []),
          ],
          next: analysed?.next ?? null,
        };
      }),
      outputs: decoded.tx.vout.map((output) => ({
        address: output.scriptPubKey?.address ?? null,
        amountSats: sats(output.value) ?? 0,
        script: output.scriptPubKey?.hex ?? null,
      })),
      feeSats: sats(analysis.fee ?? decoded.fee),
      estimatedVsize: analysis.estimated_vsize ?? null,
      // analyzepsbt reports BTC per kvB; 1 sat/vB is 0.00001 BTC/kvB.
      estimatedFeeRateSatPerVb:
        analysis.estimated_feerate === undefined ? null : Math.round(analysis.estimated_feerate * 1e7) / 100,
      next: analysis.next,
      raw,
    };
  }

  // Descriptors

  async descriptor(nodeId: string, input: string, count: number): Promise<DescriptorAnalysis> {
    const text = input.trim();
    if (containsPrivateKey(text)) {
      throw this.failure(
        'devtools.private-key',
        'This descriptor holds a private key. BTCortex never handles private keys: use the public descriptor (xpub or tpub) instead.',
      );
    }
    const info = await this.call(nodeId, 'getdescriptorinfo', [text], DescriptorInfoSchema);
    if (info.hasprivatekeys) {
      throw this.failure(
        'devtools.private-key',
        'The node reports a private key in this descriptor; use the public one instead.',
      );
    }
    // getdescriptorinfo returns the descriptor in its canonical form, checksum included.
    const descriptor = info.descriptor.includes('#') ? info.descriptor : `${info.descriptor}#${info.checksum}`;
    const total = Math.min(Math.max(1, count), MAX_ADDRESSES);
    let addresses: DescriptorAnalysis['addresses'] = [];
    let addressesError: string | null = null;
    try {
      const derived = await this.options.nodes
        .rpc(nodeId)
        .call<string[]>('deriveaddresses', info.isrange ? [descriptor, [0, total - 1]] : [descriptor]);
      addresses = derived.map((address, index) => ({ index: info.isrange ? index : null, address }));
    } catch (error) {
      addressesError = error instanceof Error ? error.message : String(error);
    }
    return {
      descriptor,
      checksum: info.checksum,
      isRange: info.isrange,
      isSolvable: info.issolvable,
      addresses,
      addressesError,
    };
  }

  // Regtest

  async mine(nodeId: string, blocks: number, address: string | undefined): Promise<MinedBlocks> {
    const { profile } = this.options.nodes.get(nodeId);
    if (profile.network !== 'regtest') {
      throw this.failure('devtools.not-regtest', 'Blocks can be generated only on regtest, where nobody else mines.');
    }
    let hashes: string[];
    if (address !== undefined) {
      const valid = await this.call(nodeId, 'validateaddress', [address], z.object({ isvalid: z.boolean() }));
      if (!valid.isvalid) throw this.failure('devtools.invalid-address', 'This is not a regtest address.');
      hashes = await this.call(nodeId, 'generatetoaddress', [blocks, address], z.array(z.string()));
    } else {
      // Anyone-can-spend coinbases: the chain moves on without a wallet.
      const info = await this.call(nodeId, 'getdescriptorinfo', ['raw(51)'], DescriptorInfoSchema);
      hashes = await this.call(
        nodeId,
        'generatetodescriptor',
        [blocks, `raw(51)#${info.checksum}`],
        z.array(z.string()),
      );
    }
    const height = await this.call(nodeId, 'getblockcount', [], z.number());
    this.options.logger.info('Generated regtest blocks', { nodeId, blocks: hashes.length, height });
    return { hashes, height };
  }

  // Protocol features

  async features(nodeId: string): Promise<ProtocolFeatures> {
    const { profile } = this.options.nodes.get(nodeId);
    const network = await this.call(nodeId, 'getnetworkinfo', [], NetworkInfoSchema);
    const deployments = await this.call(nodeId, 'getdeploymentinfo', [], DeploymentInfoSchema).catch(() => undefined);
    const indexes = await this.call(
      nodeId,
      'getindexinfo',
      [],
      z.record(z.string(), z.object({ synced: z.boolean() })),
    ).catch(() => undefined);
    const chainstates = await this.call(
      nodeId,
      'getchainstates',
      [],
      z.object({ chainstates: z.array(z.object({ snapshot_blockhash: z.string().optional() })) }),
    ).catch(() => undefined);
    let settings: Map<string, { values: string[]; negated: boolean }> | undefined;
    try {
      const document = await this.options.config.get(nodeId);
      if (document.exists) settings = resolveEffective(BitcoinConfig.parse(document.text), profile.network);
    } catch {
      settings = undefined;
    }
    const setting = (key: string) => {
      const value = settings?.get(key);
      return value === undefined || value.values.length === 0 ? undefined : value.values[0];
    };
    const switched = (key: string) => {
      const value = setting(key);
      return value === undefined ? undefined : interpretBoolean(value);
    };

    const knots = profile.implementation === 'bitcoin-knots' || network.subversion.includes('Knots');
    const major = Math.floor(network.version / 10_000);
    const minor = Math.floor((network.version % 10_000) / 100);
    const atLeast = (wantedMajor: number, wantedMinor = 0) =>
      !knots && (major > wantedMajor || (major === wantedMajor && minor >= wantedMinor));
    const services = network.localservicesnames;
    const offers = (name: string) => (services === undefined ? undefined : services.includes(name));
    const features: ProtocolFeature[] = [];
    const add = (feature: ProtocolFeature) => features.push(feature);

    for (const [name, deployment] of Object.entries(deployments?.deployments ?? {})) {
      add({
        id: `deployment.${name}`,
        title: DEPLOYMENT_TITLES[name] ?? `Soft fork: ${name}`,
        category: 'consensus',
        state: deployment.active ? 'on' : 'off',
        detail: deployment.active
          ? `Active${deployment.height === undefined ? '' : ` since block ${deployment.height.toLocaleString('en-GB')}`} (${deployment.type} deployment).`
          : `Not active yet (${deployment.type} deployment).`,
        since: null,
      });
    }
    const v2 = offers('P2P_V2');
    add({
      id: 'bip324',
      title: 'Encrypted P2P transport (BIP324)',
      category: 'implementation',
      state: v2 === undefined ? 'unknown' : v2 ? 'on' : atLeast(26) ? 'off' : 'unavailable',
      detail:
        'Version 2 connections are encrypted; peers that support them are reached that way. On by default since 27.0.',
      since: '26.0',
    });
    const filterIndex = indexes?.['basic block filter index'];
    const servesFilters = offers('COMPACT_FILTERS');
    add({
      id: 'compact-filters',
      title: 'Compact block filters (BIP157/158)',
      category: 'implementation',
      state: filterIndex ? 'on' : indexes ? 'off' : 'unknown',
      detail: filterIndex
        ? `The filter index is ${filterIndex.synced ? 'built' : 'being built'}${servesFilters ? ' and served to peers' : '; peers are not served (peerblockfilters=0)'}.`
        : 'blockfilterindex is off; light wallets on this computer cannot use the node’s filters.',
      since: '0.19',
    });
    add({
      id: 'txindex',
      title: 'Transaction index',
      category: 'implementation',
      state: indexes?.['txindex'] ? 'on' : indexes ? 'off' : 'unknown',
      detail: 'Lets the node find any transaction by its id; Electrum servers need it.',
      since: null,
    });
    add({
      id: 'package-relay',
      title: 'Package relay and submitpackage',
      category: 'relay-policy',
      state: atLeast(28) ? 'on' : 'unavailable',
      detail:
        'A low-fee parent travels with its child (one parent, one child), extended in 30.0 and 31.0; submitpackage accepts a child with its parents. P2P package messages (BIP331) are not implemented.',
      since: '28.0',
    });
    add({
      id: 'truc',
      title: 'TRUC (version 3) transactions (BIP431)',
      category: 'relay-policy',
      state: atLeast(28) ? 'on' : 'unavailable',
      detail: 'One unconfirmed parent and child, at most 10 kvB, sibling eviction, zero-fee parents inside packages.',
      since: '28.0',
    });
    add({
      id: 'ephemeral',
      title: 'Pay-to-Anchor and ephemeral dust (BIP433)',
      category: 'relay-policy',
      state: atLeast(28) ? 'on' : 'unavailable',
      detail:
        'Pay-to-Anchor spends are standard since 28.0; one dust output in a zero-fee transaction spent in the same package since 29.0.',
      since: '28.0',
    });
    add({
      id: 'full-rbf',
      title: 'Full replace-by-fee',
      category: 'relay-policy',
      state: atLeast(28) ? 'on' : 'unknown',
      detail: 'Any unconfirmed transaction can be replaced by one paying more; the option was removed in 29.0.',
      since: '28.0',
    });
    add({
      id: 'cluster-mempool',
      title: 'Cluster mempool',
      category: 'relay-policy',
      state: atLeast(31) ? 'on' : 'unavailable',
      detail:
        'Clusters of at most 64 transactions or 101 kvB, ordered by chunk fee rate; a replacement must improve the fee-rate diagram.',
      since: '31.0',
    });
    const dataCarrier = setting('datacarriersize');
    add({
      id: 'op-return',
      title: 'OP_RETURN outputs',
      category: 'relay-policy',
      state: switched('datacarrier') === false ? 'off' : 'on',
      detail:
        dataCarrier !== undefined
          ? `Relayed up to ${Number(dataCarrier).toLocaleString('en-GB')} bytes in all (datacarriersize in bitcoin.conf).`
          : knots
            ? 'Bitcoin Knots relays at most 83 bytes by default.'
            : atLeast(30)
              ? 'Up to 100,000 bytes in all, in several outputs, by default since 30.0.'
              : 'Up to 83 bytes in one output by default before 30.0.',
      since: null,
    });
    const privateBroadcast = switched('privatebroadcast');
    add({
      id: 'private-broadcast',
      title: 'Private broadcast',
      category: 'implementation',
      state: !atLeast(31)
        ? 'unavailable'
        : privateBroadcast === true
          ? 'on'
          : privateBroadcast === false
            ? 'off'
            : settings
              ? 'off'
              : 'unknown',
      detail: atLeast(31, 1)
        ? 'sendrawtransaction sends through short-lived Tor or I2P connections, without the transaction in the node’s mempool first.'
        : atLeast(31)
          ? '31.0 can reveal the sender’s address after a fallback; use 31.1 or later.'
          : 'Needs Bitcoin Core 31.1 or later.',
      since: '31.0',
    });
    const asmap = setting('asmap');
    add({
      id: 'asmap',
      title: 'Embedded asmap',
      category: 'implementation',
      state: !atLeast(31) ? 'unavailable' : asmap !== undefined && asmap !== '0' ? 'on' : settings ? 'off' : 'unknown',
      detail: 'Spreads peers across autonomous systems; off by default.',
      since: '31.0',
    });
    const snapshot = chainstates?.chainstates.some((state) => state.snapshot_blockhash !== undefined);
    add({
      id: 'assumeutxo',
      title: 'assumeutxo snapshots',
      category: 'implementation',
      state: snapshot === undefined ? 'unknown' : snapshot ? 'on' : 'off',
      detail: snapshot
        ? 'The node runs from a UTXO snapshot and validates history in the background.'
        : 'A UTXO snapshot can be loaded with loadtxoutset; there is no canonical source for snapshots.',
      since: null,
    });
    add({
      id: 'descriptor-wallets',
      title: 'Descriptor wallets only',
      category: 'wallet-policy',
      state: atLeast(30) ? 'on' : 'off',
      detail: atLeast(30)
        ? 'Legacy wallets and their RPCs were removed in 30.0; TRUC transactions can be created since 30.0.'
        : 'Legacy wallets still load on this version.',
      since: '30.0',
    });
    add({
      id: 'ipc-mining',
      title: 'IPC mining interface',
      category: 'experimental',
      state: 'unavailable',
      detail: 'Experimental since 30.0 and not built for Windows; it needs Linux or WSL2.',
      since: '30.0',
    });
    add({
      id: 'erlay',
      title: 'Erlay (BIP330)',
      category: 'experimental',
      state: 'off',
      detail: 'A debug-only option, not meant for production.',
      since: null,
    });
    const match = /:(\d+\.\d+(?:\.\d+)?)/.exec(network.subversion);
    return { nodeId, version: match?.[1] ?? null, features };
  }

  // Endpoint probes

  async probe(params: ProbeParams): Promise<ProbeResult> {
    const steps: ProbeResult['steps'] = [];
    const step = async <T>(name: string, work: () => Promise<{ value: T; detail: string }>): Promise<T | undefined> => {
      const started = performance.now();
      try {
        const { value, detail } = await work();
        steps.push({ name, ok: true, durationMs: Math.round(performance.now() - started), detail });
        return value;
      } catch (error) {
        steps.push({
          name,
          ok: false,
          durationMs: Math.round(performance.now() - started),
          detail: error instanceof Error ? error.message : String(error),
        });
        return undefined;
      }
    };
    const host = params.host.replace(/^\[|\]$/g, '');
    const onion = isOnionHost(host);
    if (onion && !params.viaTor) {
      throw this.failure('devtools.onion-needs-tor', 'Onion addresses are reached through Tor; tick “through Tor”.');
    }
    if (!params.viaTor && isIP(host) === 0) {
      const resolved = await step('Name lookup', async () => {
        const addresses = await lookup(host, { all: true });
        return { value: addresses, detail: addresses.map((entry) => entry.address).join(', ') };
      });
      if (!resolved) return { reachable: false, steps, answer: null };
    }
    const opened: Socket[] = [];
    let socket: Socket | TLSSocket | undefined = await step('Connection', async () => {
      if (params.viaTor) {
        const proxyPort = this.options.socksPort();
        if (proxyPort === undefined) throw new Error('BTCortex’s tor is not running; start it on the Tor page.');
        const value = await connectThroughSocks(
          { host, port: params.port },
          { proxyPort, isolation: 'btcortex-probe', timeoutMs: PROBE_TIMEOUT_MS },
        );
        return { value, detail: `Connected through tor to ${host}:${String(params.port)}` };
      }
      const value = await new Promise<Socket>((resolve, reject) => {
        const connection = connectTcp({ host, port: params.port });
        connection.setTimeout(PROBE_TIMEOUT_MS, () => {
          connection.destroy(new Error('No answer within 15 seconds.'));
        });
        connection.once('connect', () => {
          connection.setTimeout(0);
          resolve(connection);
        });
        connection.once('error', reject);
      });
      return { value, detail: `Connected to ${value.remoteAddress ?? host}:${String(params.port)}` };
    });
    if (!socket) return { reachable: false, steps, answer: null };
    opened.push(socket);

    try {
      if (params.tls) {
        const plain = socket;
        socket = await step('TLS', async () => {
          const secured = await new Promise<TLSSocket>((resolve, reject) => {
            const connection = connectTls({
              socket: plain,
              ...(isIP(host) === 0 ? { servername: host } : {}),
              // Never accept an invalid certificate silently (specification section 21.2).
              rejectUnauthorized: true,
            });
            connection.once('secureConnect', () => {
              resolve(connection);
            });
            connection.once('error', reject);
          });
          const certificate = secured.getPeerCertificate();
          return {
            value: secured,
            detail: `${secured.getProtocol() ?? 'TLS'}, certificate for ${String(certificate.subject.CN ?? '?')} valid until ${certificate.valid_to}`,
          };
        });
        if (!socket) return { reachable: true, steps, answer: null };
        opened.push(socket);
      }
      const connection = socket;
      const answer = await step('Answer', async () => {
        if (params.kind === 'tcp') return { value: null, detail: 'The port accepts connections.' };
        const request =
          params.kind === 'electrum'
            ? `${JSON.stringify({ id: 1, method: 'server.version', params: ['BTCortex', '1.4'] })}\n`
            : params.kind === 'bitcoin-rpc'
              ? (() => {
                  const body = JSON.stringify({ jsonrpc: '1.0', id: 'btcortex', method: 'getnetworkinfo', params: [] });
                  return `POST / HTTP/1.1\r\nHost: ${host}\r\nContent-Type: application/json\r\nContent-Length: ${String(Buffer.byteLength(body))}\r\nConnection: close\r\nUser-Agent: BTCortex\r\n\r\n${body}`;
                })()
              : `GET ${params.path ?? '/'} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\nUser-Agent: BTCortex\r\n\r\n`;
        const text = await exchange(connection, request, params.kind === 'electrum' ? '\n' : '\r\n\r\n');
        const firstLine = text.split(/\r?\n/)[0] ?? '';
        const detail =
          params.kind === 'electrum'
            ? 'The Electrum server answered server.version.'
            : params.kind === 'bitcoin-rpc'
              ? firstLine.includes(' 401 ')
                ? 'Bitcoin Core’s RPC interface answered and asks for credentials (none were sent).'
                : `The service answered ${firstLine}.`
              : `The server answered ${firstLine}.`;
        return { value: text.slice(0, ANSWER_LIMIT), detail };
      });
      return { reachable: true, steps, answer: answer ?? null };
    } finally {
      for (const connection of opened) connection.destroy();
    }
  }
}

/** Sends a request and reads until the end marker, the connection closing, or the size limit. */
function exchange(socket: Socket, request: string, until: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = '';
    const finish = () => {
      socket.removeAllListeners('data');
      resolve(text);
    };
    socket.setTimeout(PROBE_TIMEOUT_MS, () => {
      if (text === '') reject(new Error('No answer within 15 seconds.'));
      else finish();
    });
    socket.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8');
      if (text.includes(until) || text.length >= ANSWER_LIMIT) finish();
    });
    socket.once('end', finish);
    socket.once('error', reject);
    socket.write(request);
  });
}
