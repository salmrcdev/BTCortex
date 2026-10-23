import type { LndRestClient } from './rest';
import { LndRestError } from './rest';

// The parts of LND's REST interface BTCortex reads (docs/research/notes/lightning.md,
// section 2.3), turned into plain values. LND writes 64-bit numbers as strings
// and names fields in snake_case; amounts here are whole satoshis unless a name
// says otherwise. Secrets LND includes in some answers, such as the preimages
// of payments and invoices, are dropped here and never leave this module.

type Json = Record<string, unknown>;

const object = (value: unknown): Json => (typeof value === 'object' && value !== null ? (value as Json) : {});
const list = (value: unknown): Json[] => (Array.isArray(value) ? value.map(object) : []);
const string = (value: unknown): string => (typeof value === 'string' ? value : '');
const flag = (value: unknown): boolean => value === true;
/** LND's int64 and uint64 arrive as strings, smaller integers as numbers. */
const integer = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value !== '' ? Number(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
};
const sats = (value: unknown): number => Math.trunc(integer(value));
const optional = (value: string): string | undefined => (value === '' ? undefined : value);
const isoFromSeconds = (value: unknown): string | null => {
  const seconds = integer(value);
  return seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
};
const isoFromNanoseconds = (value: unknown): string | null => {
  const text = string(value);
  if (text === '' || text === '0') return null;
  return new Date(Number(BigInt(text) / 1_000_000n)).toISOString();
};

export type LndWalletState =
  'NON_EXISTING' | 'LOCKED' | 'UNLOCKED' | 'RPC_ACTIVE' | 'SERVER_ACTIVE' | 'WAITING_TO_START' | 'UNKNOWN';

const WALLET_STATES = new Set<LndWalletState>([
  'NON_EXISTING',
  'LOCKED',
  'UNLOCKED',
  'RPC_ACTIVE',
  'SERVER_ACTIVE',
  'WAITING_TO_START',
]);

/** Answers without a macaroon, even while the wallet is locked. */
export async function getWalletState(client: LndRestClient): Promise<LndWalletState> {
  const state = string(object(await client.get('/v1/state'))['state']) as LndWalletState;
  return WALLET_STATES.has(state) ? state : 'UNKNOWN';
}

export type LndNetwork = 'mainnet' | 'testnet' | 'testnet4' | 'signet' | 'regtest' | 'simnet';
const NETWORKS = new Set<string>(['mainnet', 'testnet', 'testnet4', 'signet', 'regtest', 'simnet']);

export interface LndInfo {
  /** For example `0.21.4-beta`. */
  version: string;
  commitHash: string;
  pubkey: string;
  alias: string;
  color: string;
  network: LndNetwork | null;
  blockHeight: number;
  blockHash: string;
  bestHeaderAt: string | null;
  syncedToChain: boolean;
  syncedToGraph: boolean;
  activeChannels: number;
  inactiveChannels: number;
  pendingChannels: number;
  peers: number;
  /** Public addresses the node announces, `pubkey@host:port`. */
  uris: string[];
  features: { bit: number; name: string; required: boolean }[];
}

export function parseInfo(body: unknown): LndInfo {
  const info = object(body);
  const chain = list(info['chains']).find((entry) => string(entry['chain']) === 'bitcoin');
  const network = string(chain?.['network']);
  return {
    version: string(info['version']).split(' ')[0] ?? '',
    commitHash: string(info['commit_hash']),
    pubkey: string(info['identity_pubkey']),
    alias: string(info['alias']),
    color: string(info['color']),
    network: NETWORKS.has(network) ? (network as LndNetwork) : null,
    blockHeight: integer(info['block_height']),
    blockHash: string(info['block_hash']),
    bestHeaderAt: isoFromSeconds(info['best_header_timestamp']),
    syncedToChain: flag(info['synced_to_chain']),
    syncedToGraph: flag(info['synced_to_graph']),
    activeChannels: integer(info['num_active_channels']),
    inactiveChannels: integer(info['num_inactive_channels']),
    pendingChannels: integer(info['num_pending_channels']),
    peers: integer(info['num_peers']),
    uris: Array.isArray(info['uris']) ? info['uris'].filter((uri): uri is string => typeof uri === 'string') : [],
    features: Object.entries(object(info['features']))
      .map(([bit, feature]) => ({
        bit: Number(bit),
        name: string(object(feature)['name']),
        required: flag(object(feature)['is_required']),
      }))
      .sort((a, b) => a.bit - b.bit),
  };
}

export async function getInfo(client: LndRestClient): Promise<LndInfo> {
  return parseInfo(await client.get('/v1/getinfo'));
}

export interface LndWalletBalance {
  confirmedSats: number;
  unconfirmedSats: number;
  /** Locked by LND for a pending transaction. */
  lockedSats: number;
  /** Kept back to bump the fees of anchor channels when they close. */
  reservedForAnchorsSats: number;
}

export function parseWalletBalance(body: unknown): LndWalletBalance {
  const balance = object(body);
  return {
    confirmedSats: sats(balance['confirmed_balance']),
    unconfirmedSats: sats(balance['unconfirmed_balance']),
    lockedSats: sats(balance['locked_balance']),
    reservedForAnchorsSats: sats(balance['reserved_balance_anchor_chan']),
  };
}

export async function getWalletBalance(client: LndRestClient): Promise<LndWalletBalance> {
  return parseWalletBalance(await client.get('/v1/balance/blockchain'));
}

export interface LndChannelBalance {
  localSats: number;
  remoteSats: number;
  unsettledLocalSats: number;
  unsettledRemoteSats: number;
  pendingOpenLocalSats: number;
  pendingOpenRemoteSats: number;
}

export function parseChannelBalance(body: unknown): LndChannelBalance {
  const balance = object(body);
  const amount = (name: string) => sats(object(balance[name])['sat']);
  return {
    localSats: amount('local_balance'),
    remoteSats: amount('remote_balance'),
    unsettledLocalSats: amount('unsettled_local_balance'),
    unsettledRemoteSats: amount('unsettled_remote_balance'),
    pendingOpenLocalSats: amount('pending_open_local_balance'),
    pendingOpenRemoteSats: amount('pending_open_remote_balance'),
  };
}

export async function getChannelBalance(client: LndRestClient): Promise<LndChannelBalance> {
  return parseChannelBalance(await client.get('/v1/balance/channels'));
}

export interface LndHtlc {
  incoming: boolean;
  amountSats: number;
  expiryHeight: number;
}

export interface LndChannel {
  /** The short channel id as LND writes it, a 64-bit number in decimal. */
  id: string;
  channelPoint: string;
  remotePubkey: string;
  peerAlias: string | null;
  active: boolean;
  private: boolean;
  initiator: boolean;
  capacitySats: number;
  localSats: number;
  remoteSats: number;
  localReserveSats: number;
  remoteReserveSats: number;
  commitFeeSats: number;
  unsettledSats: number;
  sentSats: number;
  receivedSats: number;
  pendingHtlcs: LndHtlc[];
  commitmentType: string;
  csvDelay: number;
  uptimeSeconds: number;
  lifetimeSeconds: number;
  zeroConf: boolean;
}

export function parseChannels(body: unknown): LndChannel[] {
  return list(object(body)['channels']).map((channel) => ({
    id: string(channel['chan_id']),
    channelPoint: string(channel['channel_point']),
    remotePubkey: string(channel['remote_pubkey']),
    peerAlias: optional(string(channel['peer_alias'])) ?? null,
    active: flag(channel['active']),
    private: flag(channel['private']),
    initiator: flag(channel['initiator']),
    capacitySats: sats(channel['capacity']),
    localSats: sats(channel['local_balance']),
    remoteSats: sats(channel['remote_balance']),
    localReserveSats: sats(channel['local_chan_reserve_sat']),
    remoteReserveSats: sats(channel['remote_chan_reserve_sat']),
    commitFeeSats: sats(channel['commit_fee']),
    unsettledSats: sats(channel['unsettled_balance']),
    sentSats: sats(channel['total_satoshis_sent']),
    receivedSats: sats(channel['total_satoshis_received']),
    pendingHtlcs: list(channel['pending_htlcs']).map((htlc) => ({
      incoming: flag(htlc['incoming']),
      amountSats: sats(htlc['amount']),
      expiryHeight: integer(htlc['expiration_height']),
    })),
    commitmentType: string(channel['commitment_type']),
    csvDelay: integer(channel['csv_delay']),
    uptimeSeconds: integer(channel['uptime']),
    lifetimeSeconds: integer(channel['lifetime']),
    zeroConf: flag(channel['zero_conf']),
  }));
}

export async function listChannels(client: LndRestClient): Promise<LndChannel[]> {
  return parseChannels(await client.get('/v1/channels', { peer_alias_lookup: true }));
}

export type LndPendingKind = 'opening' | 'closing' | 'force-closing';

export interface LndPendingChannel {
  kind: LndPendingKind;
  channelPoint: string;
  remotePubkey: string;
  capacitySats: number;
  localSats: number;
  remoteSats: number;
  initiator: 'local' | 'remote' | 'both' | 'unknown';
  /** Opening: confirmations still needed. */
  confirmationsUntilActive?: number;
  /** Closing: the closing transaction, once known. */
  closingTxid?: string;
  /** Force-closing: funds waiting for the time lock, and when they mature. */
  limboSats?: number;
  maturityHeight?: number;
  blocksUntilMaturity?: number;
}

function pendingBase(kind: LndPendingKind, entry: Json): LndPendingChannel {
  const channel = object(entry['channel']);
  const initiator = string(channel['initiator']);
  return {
    kind,
    channelPoint: string(channel['channel_point']),
    remotePubkey: string(channel['remote_node_pub']),
    capacitySats: sats(channel['capacity']),
    localSats: sats(channel['local_balance']),
    remoteSats: sats(channel['remote_balance']),
    initiator:
      initiator === 'INITIATOR_LOCAL'
        ? 'local'
        : initiator === 'INITIATOR_REMOTE'
          ? 'remote'
          : initiator === 'INITIATOR_BOTH'
            ? 'both'
            : 'unknown',
  };
}

export interface LndPendingChannels {
  /** Funds in channels that are closing and not yet spendable. */
  limboSats: number;
  channels: LndPendingChannel[];
}

export function parsePendingChannels(body: unknown): LndPendingChannels {
  const pending = object(body);
  const closingTxid = (entry: Json) => optional(string(entry['closing_txid']));
  return {
    limboSats: sats(pending['total_limbo_balance']),
    channels: [
      ...list(pending['pending_open_channels']).map((entry) => ({
        ...pendingBase('opening', entry),
        confirmationsUntilActive: integer(entry['confirmations_until_active']),
      })),
      ...list(pending['waiting_close_channels']).map((entry) => {
        const txid = closingTxid(entry) ?? optional(string(object(entry['commitments'])['local_txid']));
        return {
          ...pendingBase('closing', entry),
          limboSats: sats(entry['limbo_balance']),
          ...(txid === undefined ? {} : { closingTxid: txid }),
        };
      }),
      ...list(pending['pending_force_closing_channels']).map((entry) => {
        const txid = closingTxid(entry);
        return {
          ...pendingBase('force-closing', entry),
          limboSats: sats(entry['limbo_balance']),
          maturityHeight: integer(entry['maturity_height']),
          blocksUntilMaturity: integer(entry['blocks_til_maturity']),
          ...(txid === undefined ? {} : { closingTxid: txid }),
        };
      }),
    ],
  };
}

export async function listPendingChannels(client: LndRestClient): Promise<LndPendingChannels> {
  return parsePendingChannels(await client.get('/v1/channels/pending'));
}

export interface LndPeer {
  pubkey: string;
  address: string;
  inbound: boolean;
  bytesSent: number;
  bytesReceived: number;
  satsSent: number;
  satsReceived: number;
  /** Round trip in microseconds, when measured. */
  pingMicros: number | null;
  syncType: string;
  flapCount: number;
}

export function parsePeers(body: unknown): LndPeer[] {
  return list(object(body)['peers']).map((peer) => {
    const ping = integer(peer['ping_time']);
    return {
      pubkey: string(peer['pub_key']),
      address: string(peer['address']),
      inbound: flag(peer['inbound']),
      bytesSent: integer(peer['bytes_sent']),
      bytesReceived: integer(peer['bytes_recv']),
      satsSent: sats(peer['sat_sent']),
      satsReceived: sats(peer['sat_recv']),
      pingMicros: ping > 0 ? ping : null,
      syncType: string(peer['sync_type']),
      flapCount: integer(peer['flap_count']),
    };
  });
}

export async function listPeers(client: LndRestClient): Promise<LndPeer[]> {
  return parsePeers(await client.get('/v1/peers'));
}

export interface LndChannelFee {
  channelId: string;
  channelPoint: string;
  baseFeeMsat: number;
  feePpm: number;
  inboundBaseFeeMsat: number;
  inboundFeePpm: number;
}

export interface LndFeeReport {
  /** Routing fees earned over the last day, week and month. */
  daySats: number;
  weekSats: number;
  monthSats: number;
  channels: LndChannelFee[];
}

export function parseFeeReport(body: unknown): LndFeeReport {
  const report = object(body);
  return {
    daySats: sats(report['day_fee_sum']),
    weekSats: sats(report['week_fee_sum']),
    monthSats: sats(report['month_fee_sum']),
    channels: list(report['channel_fees']).map((fee) => ({
      channelId: string(fee['chan_id']),
      channelPoint: string(fee['channel_point']),
      baseFeeMsat: integer(fee['base_fee_msat']),
      feePpm: integer(fee['fee_per_mil']),
      inboundBaseFeeMsat: integer(fee['inbound_base_fee_msat']),
      inboundFeePpm: integer(fee['inbound_fee_per_mil']),
    })),
  };
}

export async function getFeeReport(client: LndRestClient): Promise<LndFeeReport> {
  return parseFeeReport(await client.get('/v1/fees'));
}

export interface LndForward {
  at: string | null;
  channelIn: string;
  channelOut: string;
  peerAliasIn: string | null;
  peerAliasOut: string | null;
  amountInSats: number;
  amountOutSats: number;
  feeMsat: number;
}

export function parseForwards(body: unknown): LndForward[] {
  return list(object(body)['forwarding_events']).map((event) => ({
    at: isoFromNanoseconds(event['timestamp_ns']) ?? isoFromSeconds(event['timestamp']),
    channelIn: string(event['chan_id_in']),
    channelOut: string(event['chan_id_out']),
    peerAliasIn: optional(string(event['peer_alias_in'])) ?? null,
    peerAliasOut: optional(string(event['peer_alias_out'])) ?? null,
    amountInSats: sats(event['amt_in']),
    amountOutSats: sats(event['amt_out']),
    feeMsat: integer(event['fee_msat']),
  }));
}

/**
 * Forwards since `since`, newest first. LND counts `max` from `since`
 * onwards, so a busy node's latest forwards need a recent `since`.
 */
export async function listForwards(
  client: LndRestClient,
  { since, max }: { since: Date; max: number },
): Promise<LndForward[]> {
  const events = parseForwards(
    await client.post('/v1/switch', {
      start_time: String(Math.floor(since.getTime() / 1000)),
      num_max_events: max,
      peer_alias_lookup: true,
    }),
  );
  return events.reverse();
}

export type LndInvoiceState = 'OPEN' | 'SETTLED' | 'CANCELED' | 'ACCEPTED';

export interface LndInvoice {
  /** The payment hash, which the invoice shows to anyone it is given to. */
  paymentHash: string;
  memo: string;
  valueSats: number;
  paidSats: number;
  state: LndInvoiceState;
  createdAt: string | null;
  settledAt: string | null;
  expiresAt: string | null;
  private: boolean;
  keysend: boolean;
}

export function parseInvoices(body: unknown): LndInvoice[] {
  return list(object(body)['invoices']).map((invoice) => {
    const created = integer(invoice['creation_date']);
    const expiry = integer(invoice['expiry']);
    const state = string(invoice['state']);
    return {
      paymentHash: Buffer.from(string(invoice['r_hash']), 'base64').toString('hex'),
      memo: string(invoice['memo']),
      valueSats: sats(invoice['value']),
      paidSats: sats(invoice['amt_paid_sat']),
      state: (['OPEN', 'SETTLED', 'CANCELED', 'ACCEPTED'].includes(state) ? state : 'OPEN') as LndInvoiceState,
      createdAt: isoFromSeconds(created),
      settledAt: isoFromSeconds(invoice['settle_date']),
      expiresAt: created > 0 && expiry > 0 ? new Date((created + expiry) * 1000).toISOString() : null,
      private: flag(invoice['private']),
      keysend: flag(invoice['is_keysend']),
    };
  });
}

/** The latest invoices, newest first. */
export async function listInvoices(client: LndRestClient, max: number): Promise<LndInvoice[]> {
  return parseInvoices(await client.get('/v1/invoices', { num_max_invoices: max, reversed: true })).reverse();
}

export type LndPaymentStatus = 'IN_FLIGHT' | 'SUCCEEDED' | 'FAILED' | 'INITIATED' | 'UNKNOWN';

export interface LndPayment {
  paymentHash: string;
  valueSats: number;
  feeMsat: number;
  status: LndPaymentStatus;
  createdAt: string | null;
  failureReason: string | null;
  /** The node paid, from the route that succeeded or was last tried. */
  destination: string | null;
  hops: number | null;
}

export function parsePayments(body: unknown): LndPayment[] {
  return list(object(body)['payments']).map((payment) => {
    const status = string(payment['status']);
    const attempts = list(payment['htlcs']);
    const route = object(
      (attempts.find((attempt) => string(attempt['status']) === 'SUCCEEDED') ?? attempts.at(-1))?.['route'],
    );
    const hops = list(route['hops']);
    const failure = string(payment['failure_reason']);
    return {
      paymentHash: string(payment['payment_hash']),
      valueSats: sats(payment['value_sat']),
      feeMsat: integer(payment['fee_msat']),
      status: (['IN_FLIGHT', 'SUCCEEDED', 'FAILED', 'INITIATED'].includes(status)
        ? status
        : 'UNKNOWN') as LndPaymentStatus,
      createdAt: isoFromNanoseconds(payment['creation_time_ns']) ?? isoFromSeconds(payment['creation_date']),
      failureReason: failure === '' || failure === 'FAILURE_REASON_NONE' ? null : failure,
      destination: optional(string(hops.at(-1)?.['pub_key'])) ?? null,
      hops: hops.length > 0 ? hops.length : null,
    };
  });
}

/** The latest payments, newest first, including those still in flight. */
export async function listPayments(client: LndRestClient, max: number): Promise<LndPayment[]> {
  return parsePayments(
    await client.get('/v1/payments', { max_payments: max, reversed: true, include_incomplete: true }),
  ).reverse();
}

export interface LndNetworkGraph {
  nodes: number;
  channels: number;
  capacitySats: number;
}

export function parseNetworkGraph(body: unknown): LndNetworkGraph {
  const graph = object(body);
  return {
    nodes: integer(graph['num_nodes']),
    channels: integer(graph['num_channels']),
    capacitySats: sats(graph['total_network_capacity']),
  };
}

export async function getNetworkGraph(client: LndRestClient): Promise<LndNetworkGraph> {
  return parseNetworkGraph(await client.get('/v1/graph/info'));
}

export interface LndWatchtowers {
  /** False when the node runs without its watchtower client (wtclient.active). */
  clientActive: boolean;
  towers: number;
  activeTowers: number;
}

export async function getWatchtowers(client: LndRestClient): Promise<LndWatchtowers> {
  try {
    const towers = list(object(await client.get('/v2/watchtower/client', { include_sessions: false }))['towers']);
    return {
      clientActive: true,
      towers: towers.length,
      activeTowers: towers.filter((tower) => flag(tower['active_session_candidate'])).length,
    };
  } catch (error) {
    if (error instanceof LndRestError && /watchtower client not active/i.test(error.message)) {
      return { clientActive: false, towers: 0, activeTowers: 0 };
    }
    throw error;
  }
}

/**
 * The static channel backup of every channel, as LND exports it: encrypted
 * with a key derived from the node's seed, so it is safe to keep anywhere but
 * useful only together with that seed.
 */
export async function exportChannelBackup(
  client: LndRestClient,
): Promise<{ backup: Uint8Array; channelPoints: number }> {
  const multi = object(object(await client.get('/v1/channels/backup'))['multi_chan_backup']);
  return {
    backup: Uint8Array.from(Buffer.from(string(multi['multi_chan_backup']), 'base64')),
    channelPoints: list(multi['chan_points']).length,
  };
}
