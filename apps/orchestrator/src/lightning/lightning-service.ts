import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';
import { z } from 'zod';
import { AppFailure, ChannelBackupRecordSchema, LightningConnectionSchema } from '@btcortex/contracts';
import type {
  AddLightningParams,
  AppError,
  ChannelBackupRecord,
  LightningChannel,
  LightningConnection,
  LightningConnectionWithStatus,
  LightningDashboard,
  LightningStatus,
  LightningWarning,
  LocalLightningNode,
  OrchestratorEvent,
  RecoveryAction,
} from '@btcortex/contracts';
import {
  certificateExpiry,
  certificateFingerprint,
  describeMacaroon,
  exportChannelBackup,
  findLocalLnd,
  getChannelBalance,
  getFeeReport,
  getInfo,
  getNetworkGraph,
  getWalletBalance,
  getWalletState,
  getWatchtowers,
  listChannels,
  listForwards,
  listInvoices,
  listPayments,
  listPeers,
  listPendingChannels,
  LndRestClient,
  LndRestError,
  LndTransportError,
  MacaroonFormatError,
  parseLndConnectUri,
  parseRestAddress,
} from '@btcortex/integration-lnd';
import type { LndInfo, LocalLnd } from '@btcortex/integration-lnd';
import { connectThroughSocks } from '@btcortex/integration-tor';
import type { Logger } from '../logging/logger';
import type { SettingsStore } from '../persistence/settings';
import type { AppPaths } from '../platform/paths';
import type { SecretVault } from '../vault/vault';
import { isOnionHost } from '@btcortex/core';

// Lightning nodes (specification section 11; docs/research/notes/lightning.md):
// BTCortex connects to LND over its REST interface, on this computer or
// another, with the node's certificate pinned and its macaroon kept in the
// vault. It recommends the read-only macaroon, because it only reads, and
// saves the node's static channel backups. It never moves funds or changes
// channels. Each node is checked regularly and its state published.

const COMPONENT = 'Lightning (LND)';
const SETTINGS_KEY = 'lightning';
const CHECK_INTERVAL_MS = 30_000;
const PUBLISH_DELAY_MS = 200;
const RECENT_ITEMS = 25;
const FORWARD_WINDOW_DAYS = 30;
const FORWARDS_LIMIT = 50_000;
/** A channel with less than this share on one side can hardly send, or receive. */
const LOW_LIQUIDITY_SHARE = 0.1;
const MACAROON_EXPIRY_WARNING_MS = 7 * 24 * 60 * 60 * 1000;
const CERTIFICATE_EXPIRY_WARNING_MS = 30 * 24 * 60 * 60 * 1000;

/** The expiry is read from the certificate itself whenever the connection is shown. */
const StoredConnectionSchema = LightningConnectionSchema.omit({ certificateExpiresAt: true }).extend({
  /** The vault entry holding the macaroon (hex). */
  secretId: z.string(),
  /** PEM; public, so it is kept with the settings. */
  tlsCertificate: z.string().nullable(),
  backup: ChannelBackupRecordSchema.nullable(),
});
type StoredConnection = z.infer<typeof StoredConnectionSchema>;
const LightningSettingsSchema = z.object({ connections: z.array(StoredConnectionSchema) });

export interface LightningServiceOptions {
  settings: SettingsStore;
  vault: Pick<SecretVault, 'store' | 'reveal' | 'remove'>;
  paths: Pick<AppPaths, 'root'>;
  logger: Logger;
  publish: (event: OrchestratorEvent) => void;
  /** BTCortex's tor, for onion addresses: its application SOCKS port while it runs. */
  torSocksPort?: () => number | undefined;
  now?: () => Date;
  /** For tests. */
  findLocal?: () => LocalLnd | undefined;
  readFile?: (path: string) => Buffer;
  timeoutMs?: number;
}

interface ResolvedSource {
  restAddress: string;
  tlsCertificate: string | null;
  macaroon: string;
  local: boolean;
}

function emptyStatus(connectionId: string): LightningStatus {
  return {
    connectionId,
    state: 'checking',
    checkedAt: null,
    walletState: null,
    alias: null,
    pubkey: null,
    network: null,
    version: null,
    blockHeight: null,
    syncedToChain: false,
    syncedToGraph: false,
    activeChannels: 0,
    inactiveChannels: 0,
    pendingChannels: 0,
    peers: 0,
  };
}

function isOnion(restAddress: string): boolean {
  return isOnionHost(parseRestAddress(restAddress).host);
}

export class LightningService {
  private readonly statuses = new Map<string, LightningStatus>();
  private readonly publishTimers = new Map<string, NodeJS.Timeout>();
  private timer: NodeJS.Timeout | undefined;
  private closing = false;

  constructor(private readonly options: LightningServiceOptions) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private failure(code: string, message: string, extra: Partial<AppError> = {}): AppFailure {
    return new AppFailure({ code, message, component: COMPONENT, dataRisk: 'none', recoveryActions: [], ...extra });
  }

  // Settings

  private entries(): StoredConnection[] {
    return this.options.settings.get(SETTINGS_KEY, LightningSettingsSchema)?.connections ?? [];
  }

  private entry(connectionId: string): StoredConnection {
    const entry = this.entries().find((candidate) => candidate.id === connectionId);
    if (!entry) throw this.failure('lightning.unknown-connection', 'BTCortex has no such Lightning connection.');
    return entry;
  }

  private save(entries: StoredConnection[]): void {
    this.options.settings.set(SETTINGS_KEY, { connections: entries });
  }

  private publicConnection(entry: StoredConnection): LightningConnection {
    return LightningConnectionSchema.parse({
      ...entry,
      certificateExpiresAt: entry.tlsCertificate === null ? null : certificateExpiry(entry.tlsCertificate),
    });
  }

  // Lifecycle

  /** Checks every connection now and then regularly. */
  initialise(): void {
    void this.checkAll();
  }

  shutdown(): void {
    this.closing = true;
    clearTimeout(this.timer);
    for (const timer of this.publishTimers.values()) clearTimeout(timer);
    this.publishTimers.clear();
  }

  private async checkAll(): Promise<void> {
    clearTimeout(this.timer);
    await Promise.all(this.entries().map((entry) => this.check(entry).catch(() => undefined)));
    if (this.closing) return;
    this.timer = setTimeout(() => void this.checkAll(), CHECK_INTERVAL_MS);
    this.timer.unref();
  }

  private schedulePublish(connectionId: string): void {
    if (this.closing || this.publishTimers.has(connectionId)) return;
    const timer = setTimeout(() => {
      this.publishTimers.delete(connectionId);
      const status = this.statuses.get(connectionId);
      if (status) this.options.publish({ type: 'lightning.status', at: this.now().toISOString(), payload: status });
    }, PUBLISH_DELAY_MS);
    timer.unref();
    this.publishTimers.set(connectionId, timer);
  }

  // Connections

  list(): LightningConnectionWithStatus[] {
    return this.entries().map((entry) => ({
      connection: this.publicConnection(entry),
      status: this.statuses.get(entry.id) ?? emptyStatus(entry.id),
    }));
  }

  private client(restAddress: string, tlsCertificate: string | null, macaroon: string | undefined, isolation: string) {
    const endpoint = parseRestAddress(restAddress);
    const onion = isOnionHost(endpoint.host);
    let connect: ((target: { host: string; port: number }) => Promise<Duplex>) | undefined;
    if (onion) {
      const socksPort = this.options.torSocksPort?.();
      if (socksPort === undefined) {
        throw this.failure(
          'lightning.tor-needed',
          'This node has an onion address, and BTCortex’s tor is not running.',
          {
            likelyCause: 'Onion addresses are reached through Tor.',
            recoveryActions: [{ id: 'open-tor', label: 'Open Tor & Privacy' }],
          },
        );
      }
      connect = (target) => connectThroughSocks(target, { proxyPort: socksPort, isolation });
    }
    return new LndRestClient({
      endpoint,
      ...(tlsCertificate === null ? {} : { tlsCertificate }),
      ...(macaroon === undefined ? {} : { macaroon }),
      timeoutMs: this.options.timeoutMs ?? (onion ? 60_000 : 15_000),
      ...(connect ? { connect } : {}),
    });
  }

  private async clientFor(entry: StoredConnection): Promise<LndRestClient> {
    const macaroon = await this.options.vault.reveal(entry.secretId);
    return this.client(entry.restAddress, entry.tlsCertificate, macaroon, `btcortex-lightning-${entry.id}`);
  }

  /** The LND on this computer, if any, and whether BTCortex already uses it. */
  async detectLocal(): Promise<LocalLightningNode | null> {
    const found = (this.options.findLocal ?? findLocalLnd)();
    if (!found) return null;
    const read = this.options.readFile ?? ((path: string) => readFileSync(path));
    const macaroons = found.macaroons.flatMap((macaroon) => {
      try {
        return [{ kind: macaroon.kind, access: describeMacaroon(read(macaroon.path)).access }];
      } catch {
        return [];
      }
    });
    let running = false;
    if (found.restAddress !== null && found.tlsCertificateFound) {
      try {
        const certificate = read(found.tlsCertificatePath).toString('utf8');
        await getWalletState(this.client(found.restAddress, certificate, undefined, 'btcortex-lightning-local'));
        running = true;
      } catch {
        running = false;
      }
    }
    const connection = this.entries().find((entry) => entry.local);
    return {
      implementation: 'lnd',
      directory: found.lndDirectory,
      network: found.network,
      restAddress: found.restAddress,
      tlsCertificateFound: found.tlsCertificateFound,
      macaroons,
      connectionId: connection?.id ?? null,
      running,
    };
  }

  private resolveSource(params: AddLightningParams): ResolvedSource {
    const read = this.options.readFile ?? ((path: string) => readFileSync(path));
    const source = params.source;
    try {
      if (source.kind === 'lndconnect') {
        const details = parseLndConnectUri(source.uri);
        if (details.grpcPort) {
          throw this.failure(
            'lightning.grpc-port',
            'This lndconnect address names port 10009, LND’s gRPC port. BTCortex uses LND’s REST interface, on port 8080 unless lnd.conf says otherwise (restlisten).',
          );
        }
        return {
          restAddress: details.restAddress,
          tlsCertificate: details.tlsCertificate ?? null,
          macaroon: details.macaroon,
          local: false,
        };
      }
      if (source.kind === 'files') {
        const restAddress = parseRestAddress(source.restAddress);
        return {
          restAddress: `${restAddress.host.includes(':') ? `[${restAddress.host}]` : restAddress.host}:${String(restAddress.port)}`,
          tlsCertificate:
            source.tlsCertificatePath === undefined ? null : read(source.tlsCertificatePath).toString('utf8'),
          macaroon: read(source.macaroonPath).toString('hex'),
          local: false,
        };
      }
      const found = (this.options.findLocal ?? findLocalLnd)();
      if (!found) throw this.failure('lightning.local-not-found', 'BTCortex found no LND on this computer.');
      if (found.restAddress === null) {
        throw this.failure(
          'lightning.rest-disabled',
          'The LND on this computer has its REST interface switched off (norest in lnd.conf), and BTCortex connects through it.',
        );
      }
      if (!found.tlsCertificateFound) {
        throw this.failure(
          'lightning.no-certificate',
          'The LND on this computer has not created its TLS certificate yet.',
          {
            likelyCause: 'LND creates tls.cert the first time it starts.',
          },
        );
      }
      const macaroon = found.macaroons.find((candidate) => candidate.kind === source.macaroon);
      if (!macaroon) {
        throw this.failure(
          'lightning.no-macaroon',
          `The LND on this computer has no ${source.macaroon} macaroon for its network yet.`,
          { likelyCause: 'LND creates its macaroons once its wallet has been created.' },
        );
      }
      return {
        restAddress: found.restAddress,
        tlsCertificate: read(found.tlsCertificatePath).toString('utf8'),
        macaroon: read(macaroon.path).toString('hex'),
        local: true,
      };
    } catch (error) {
      if (error instanceof AppFailure) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      throw this.failure('lightning.invalid-source', `BTCortex could not use these connection details: ${reason}`);
    }
  }

  /** Connects to a node after checking it answers with the given certificate and macaroon. */
  async add(params: AddLightningParams): Promise<LightningConnectionWithStatus> {
    const source = this.resolveSource(params);
    let macaroon;
    try {
      macaroon = describeMacaroon(source.macaroon);
    } catch (error) {
      throw this.failure(
        'lightning.invalid-macaroon',
        error instanceof MacaroonFormatError ? error.message : 'This is not a macaroon LND baked.',
      );
    }
    if ((macaroon.access === 'admin' || macaroon.access === 'custom') && params.acceptSpendingMacaroon !== true) {
      throw this.failure(
        'lightning.spending-macaroon',
        macaroon.access === 'admin'
          ? 'This macaroon can move the node’s funds. BTCortex only reads, so LND’s read-only macaroon (readonly.macaroon) is enough and safer.'
          : 'This macaroon can change the node. BTCortex only reads, so LND’s read-only macaroon (readonly.macaroon) is enough and safer.',
        {
          details: { access: macaroon.access },
          recoveryActions: [{ id: 'accept-spending-macaroon', label: 'Use it anyway' }],
        },
      );
    }
    let fingerprint: string | null = null;
    if (source.tlsCertificate !== null) {
      try {
        fingerprint = certificateFingerprint(source.tlsCertificate);
      } catch (error) {
        throw this.failure('lightning.invalid-certificate', error instanceof Error ? error.message : String(error));
      }
    }
    const id = randomUUID();
    const client = this.client(source.restAddress, source.tlsCertificate, source.macaroon, `btcortex-lightning-${id}`);
    const probe = await this.probe(client);
    if (probe.failure) throw new AppFailure(probe.failure);
    const pubkey = probe.info?.pubkey;
    if (pubkey !== undefined && this.entries().some((entry) => this.statuses.get(entry.id)?.pubkey === pubkey)) {
      throw this.failure('lightning.duplicate', 'BTCortex is already connected to this node.');
    }

    const secretId = await this.options.vault.store(`LND macaroon (${params.name})`, source.macaroon);
    const entry: StoredConnection = {
      id,
      name: params.name,
      implementation: 'lnd',
      restAddress: source.restAddress,
      via: isOnion(source.restAddress) ? 'tor' : 'direct',
      certificateFingerprint: fingerprint,
      macaroon: {
        access: macaroon.access,
        permissions: macaroon.permissions,
        caveats: macaroon.caveats,
        ...(macaroon.expiresAt === undefined ? {} : { expiresAt: macaroon.expiresAt }),
      },
      local: source.local,
      createdAt: this.now().toISOString(),
      secretId,
      tlsCertificate: source.tlsCertificate,
      backup: null,
    };
    this.save([...this.entries(), entry]);
    this.options.logger.info('Connected to a Lightning node', {
      connectionId: id,
      restAddress: source.restAddress,
      access: macaroon.access,
    });
    const status = this.record(entry.id, probe);
    return { connection: this.publicConnection(entry), status };
  }

  remove(connectionId: string): void {
    const entry = this.entry(connectionId);
    this.save(this.entries().filter((candidate) => candidate.id !== connectionId));
    this.options.vault.remove(entry.secretId);
    this.statuses.delete(connectionId);
    clearTimeout(this.publishTimers.get(connectionId));
    this.publishTimers.delete(connectionId);
    this.options.logger.info('Removed a Lightning connection', { connectionId });
  }

  // Checks

  private describe(error: unknown): AppError {
    const recovery = (actions: RecoveryAction[]) => actions;
    if (error instanceof AppFailure) return error.error;
    if (error instanceof LndTransportError) {
      if (error.failure === 'certificate') {
        return {
          code: 'lightning.certificate-mismatch',
          message: error.message,
          component: COMPONENT,
          dataRisk: 'none',
          likelyCause:
            'LND created a new certificate (after its tls.cert was deleted or its addresses changed), or something else answers at this address.',
          recoveryActions: recovery([{ id: 'reconnect', label: 'Connect again with the current tls.cert' }]),
        };
      }
      return {
        code: error.failure === 'protocol' ? 'lightning.not-lnd' : 'lightning.unreachable',
        message: error.message,
        component: COMPONENT,
        dataRisk: 'none',
        ...(error.failure === 'protocol'
          ? { likelyCause: 'The address points at another service, or at LND’s gRPC port instead of its REST port.' }
          : { likelyCause: 'LND is not running, or it listens elsewhere (restlisten in lnd.conf).' }),
        recoveryActions: recovery([{ id: 'retry', label: 'Check again' }]),
      };
    }
    if (error instanceof LndRestError) {
      const code =
        error.kind === 'auth'
          ? 'lightning.macaroon-rejected'
          : error.kind === 'permission'
            ? 'lightning.permission-denied'
            : error.kind === 'locked'
              ? 'lightning.wallet-locked'
              : 'lightning.error';
      return {
        code,
        message: `LND answered: ${error.message}`,
        component: COMPONENT,
        dataRisk: 'none',
        ...(error.kind === 'auth'
          ? { likelyCause: 'The macaroon belongs to another node, or LND’s macaroons were recreated.' }
          : {}),
        details: { status: error.status, ...(error.grpcCode === undefined ? {} : { grpcCode: error.grpcCode }) },
        recoveryActions: recovery([{ id: 'retry', label: 'Check again' }]),
      };
    }
    return {
      code: 'lightning.error',
      message: error instanceof Error ? error.message : String(error),
      component: COMPONENT,
      dataRisk: 'none',
      recoveryActions: [{ id: 'retry', label: 'Check again' }],
    };
  }

  private async probe(
    client: LndRestClient,
  ): Promise<{ walletState: string | null; info?: LndInfo; failure?: AppError }> {
    let walletState: string | null = null;
    try {
      walletState = await getWalletState(client);
    } catch (error) {
      // Old versions without /v1/state go straight to getinfo; anything else is reported.
      if (!(error instanceof LndRestError && error.kind === 'not-found'))
        return { walletState, failure: this.describe(error) };
    }
    if (
      walletState !== null &&
      walletState !== 'SERVER_ACTIVE' &&
      walletState !== 'RPC_ACTIVE' &&
      walletState !== 'UNKNOWN'
    ) {
      return { walletState };
    }
    try {
      return { walletState, info: await getInfo(client) };
    } catch (error) {
      return { walletState, failure: this.describe(error) };
    }
  }

  private record(
    connectionId: string,
    probe: { walletState: string | null; info?: LndInfo; failure?: AppError },
  ): LightningStatus {
    const previous = this.statuses.get(connectionId) ?? emptyStatus(connectionId);
    const info = probe.info;
    let state: LightningStatus['state'];
    if (probe.failure) {
      state =
        probe.failure.code === 'lightning.unreachable'
          ? 'unreachable'
          : ['lightning.certificate-mismatch', 'lightning.macaroon-rejected', 'lightning.permission-denied'].includes(
                probe.failure.code,
              )
            ? 'unauthorised'
            : probe.failure.code === 'lightning.wallet-locked'
              ? 'locked'
              : 'failed';
    } else if (!info) {
      state = 'locked';
    } else {
      state = info.syncedToChain && info.syncedToGraph ? 'ready' : 'syncing';
    }
    const status: LightningStatus = {
      ...(info
        ? {
            ...emptyStatus(connectionId),
            alias: info.alias,
            pubkey: info.pubkey,
            network: info.network,
            version: info.version,
            blockHeight: info.blockHeight,
            syncedToChain: info.syncedToChain,
            syncedToGraph: info.syncedToGraph,
            activeChannels: info.activeChannels,
            inactiveChannels: info.inactiveChannels,
            pendingChannels: info.pendingChannels,
            peers: info.peers,
          }
        : // Without an answer, what was last known stays visible next to the new state.
          { ...previous }),
      connectionId,
      state,
      checkedAt: this.now().toISOString(),
      walletState: probe.walletState,
      ...(probe.failure ? { error: probe.failure } : {}),
    };
    if (!probe.failure) delete status.error;
    const changed = JSON.stringify({ ...previous, checkedAt: null }) !== JSON.stringify({ ...status, checkedAt: null });
    this.statuses.set(connectionId, status);
    if (changed) {
      if (previous.state !== status.state) {
        this.options.logger.info('Lightning node state changed', {
          connectionId,
          from: previous.state,
          to: status.state,
          ...(status.error ? { error: status.error.code } : {}),
        });
      }
      this.schedulePublish(connectionId);
    }
    return status;
  }

  private async check(entry: StoredConnection): Promise<LightningStatus> {
    let client: LndRestClient;
    try {
      client = await this.clientFor(entry);
    } catch (error) {
      return this.record(entry.id, { walletState: null, failure: this.describe(error) });
    }
    return this.record(entry.id, await this.probe(client));
  }

  async refresh(connectionId: string): Promise<LightningStatus> {
    return this.check(this.entry(connectionId));
  }

  // Dashboard

  async dashboard(connectionId: string): Promise<LightningDashboard> {
    const entry = this.entry(connectionId);
    const client = await this.clientFor(entry);
    let info: LndInfo;
    try {
      info = await getInfo(client);
    } catch (error) {
      const status = this.record(entry.id, { walletState: null, failure: this.describe(error) });
      throw new AppFailure(status.error ?? this.describe(error));
    }
    const status = this.record(entry.id, { walletState: 'SERVER_ACTIVE', info });

    const unavailable: LightningDashboard['unavailable'] = [];
    const attempt = async <T>(part: string, read: () => Promise<T>): Promise<T | null> => {
      try {
        return await read();
      } catch (error) {
        unavailable.push({
          part,
          reason:
            error instanceof LndRestError && error.kind === 'permission'
              ? 'The macaroon does not allow BTCortex to read this.'
              : this.describe(error).message,
        });
        return null;
      }
    };
    const since = new Date(this.now().getTime() - FORWARD_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const [walletBalance, channelBalance, channels, pending, peers, fees, forwards, invoices, payments, graph, towers] =
      await Promise.all([
        attempt('On-chain balance', () => getWalletBalance(client)),
        attempt('Channel balance', () => getChannelBalance(client)),
        attempt('Channels', () => listChannels(client)),
        attempt('Pending channels', () => listPendingChannels(client)),
        attempt('Peers', () => listPeers(client)),
        attempt('Routing fees', () => getFeeReport(client)),
        attempt('Forwards', () => listForwards(client, { since, max: FORWARDS_LIMIT })),
        attempt('Invoices', () => listInvoices(client, RECENT_ITEMS)),
        attempt('Payments', () => listPayments(client, RECENT_ITEMS)),
        attempt('Network graph', () => getNetworkGraph(client)),
        attempt('Watchtowers', () => getWatchtowers(client)),
      ]);

    const policies = new Map((fees?.channels ?? []).map((fee) => [fee.channelId, fee]));
    const dashboardChannels: LightningChannel[] = (channels ?? []).map((channel) => {
      const policy = policies.get(channel.id);
      return {
        id: channel.id,
        channelPoint: channel.channelPoint,
        remotePubkey: channel.remotePubkey,
        peerAlias: channel.peerAlias,
        active: channel.active,
        private: channel.private,
        initiator: channel.initiator,
        capacitySats: channel.capacitySats,
        localSats: channel.localSats,
        remoteSats: channel.remoteSats,
        localReserveSats: channel.localReserveSats,
        remoteReserveSats: channel.remoteReserveSats,
        commitFeeSats: channel.commitFeeSats,
        unsettledSats: channel.unsettledSats,
        sentSats: channel.sentSats,
        receivedSats: channel.receivedSats,
        pendingHtlcs: channel.pendingHtlcs,
        commitmentType: channel.commitmentType,
        csvDelay: channel.csvDelay,
        uptimeSeconds: channel.uptimeSeconds,
        lifetimeSeconds: channel.lifetimeSeconds,
        baseFeeMsat: policy?.baseFeeMsat ?? null,
        feePpm: policy?.feePpm ?? null,
      };
    });
    const aliases = new Map(dashboardChannels.map((channel) => [channel.remotePubkey, channel.peerAlias]));
    const allForwards = forwards ?? [];

    return {
      connection: this.publicConnection(entry),
      status,
      info: {
        pubkey: info.pubkey,
        alias: info.alias,
        color: info.color,
        version: info.version,
        commitHash: info.commitHash,
        network: info.network,
        blockHeight: info.blockHeight,
        blockHash: info.blockHash,
        bestHeaderAt: info.bestHeaderAt,
        syncedToChain: info.syncedToChain,
        syncedToGraph: info.syncedToGraph,
        uris: info.uris,
        features: info.features,
      },
      balances: {
        onChain: walletBalance ?? { confirmedSats: 0, unconfirmedSats: 0, lockedSats: 0, reservedForAnchorsSats: 0 },
        channels: channelBalance ?? {
          localSats: 0,
          remoteSats: 0,
          unsettledLocalSats: 0,
          unsettledRemoteSats: 0,
          pendingOpenLocalSats: 0,
          pendingOpenRemoteSats: 0,
        },
      },
      channels: dashboardChannels,
      pending: pending ?? { limboSats: 0, channels: [] },
      peers: (peers ?? []).map((peer) => ({ ...peer, alias: aliases.get(peer.pubkey) ?? null })),
      routing: {
        feesDaySats: fees?.daySats ?? 0,
        feesWeekSats: fees?.weekSats ?? 0,
        feesMonthSats: fees?.monthSats ?? 0,
        forwards30Days: allForwards.length,
        forwardedSats30Days: allForwards.reduce((sum, forward) => sum + forward.amountOutSats, 0),
        recentForwards: allForwards.slice(0, RECENT_ITEMS),
      },
      invoices: invoices ?? [],
      payments: payments ?? [],
      graph,
      watchtowers: towers,
      backup: entry.backup,
      warnings: this.warnings(entry, info, dashboardChannels, pending?.channels ?? []),
      unavailable,
    };
  }

  private warnings(
    entry: StoredConnection,
    info: LndInfo,
    channels: LightningChannel[],
    pending: LightningDashboard['pending']['channels'],
  ): LightningWarning[] {
    const warnings: LightningWarning[] = [];
    if (!info.syncedToChain || !info.syncedToGraph) {
      warnings.push({
        code: 'not-synced',
        severity: 'warning',
        message: !info.syncedToChain
          ? 'LND is still catching up with the chain; payments and channel changes wait until it has.'
          : 'LND is still learning the network graph, so it may not find routes for payments yet.',
      });
    }
    const inactive = channels.filter((channel) => !channel.active);
    if (inactive.length > 0) {
      warnings.push({
        code: 'inactive-channels',
        severity: 'warning',
        message: `${String(inactive.length)} channel${inactive.length === 1 ? ' is' : 's are'} inactive: the peer is offline, so ${inactive.length === 1 ? 'it' : 'they'} can neither route nor pay.`,
        channelIds: inactive.map((channel) => channel.id),
      });
    }
    const usable = channels.filter((channel) => channel.active && channel.capacitySats > 0);
    const lowOutbound = usable.filter((channel) => channel.localSats / channel.capacitySats < LOW_LIQUIDITY_SHARE);
    if (lowOutbound.length > 0) {
      warnings.push({
        code: 'low-outbound',
        severity: 'info',
        message: `${String(lowOutbound.length)} channel${lowOutbound.length === 1 ? ' has' : 's have'} less than a tenth of ${lowOutbound.length === 1 ? 'its' : 'their'} capacity on this node’s side, so ${lowOutbound.length === 1 ? 'it' : 'they'} can hardly send.`,
        channelIds: lowOutbound.map((channel) => channel.id),
      });
    }
    const lowInbound = usable.filter((channel) => channel.remoteSats / channel.capacitySats < LOW_LIQUIDITY_SHARE);
    if (lowInbound.length > 0) {
      warnings.push({
        code: 'low-inbound',
        severity: 'info',
        message: `${String(lowInbound.length)} channel${lowInbound.length === 1 ? ' has' : 's have'} less than a tenth of ${lowInbound.length === 1 ? 'its' : 'their'} capacity on the peer’s side, so ${lowInbound.length === 1 ? 'it' : 'they'} can hardly receive.`,
        channelIds: lowInbound.map((channel) => channel.id),
      });
    }
    const forceClosing = pending.filter((channel) => channel.kind === 'force-closing');
    if (forceClosing.length > 0) {
      const longest = Math.max(...forceClosing.map((channel) => channel.blocksUntilMaturity ?? 0));
      warnings.push({
        code: 'force-closing',
        severity: 'warning',
        message: `${String(forceClosing.length)} channel${forceClosing.length === 1 ? ' was' : 's were'} force-closed; the funds become spendable after a time lock (up to ${String(longest)} more blocks).`,
      });
    }
    if (entry.macaroon.access === 'admin' || entry.macaroon.access === 'custom') {
      warnings.push({
        code: 'admin-macaroon',
        severity: 'warning',
        message:
          'BTCortex holds a macaroon that can change this node or move its funds, more than it needs. Connecting with readonly.macaroon is safer.',
      });
    }
    if (
      entry.macaroon.expiresAt !== undefined &&
      new Date(entry.macaroon.expiresAt).getTime() - this.now().getTime() < MACAROON_EXPIRY_WARNING_MS
    ) {
      warnings.push({
        code: 'macaroon-expiring',
        severity: 'warning',
        message: `The macaroon stops working on ${entry.macaroon.expiresAt.slice(0, 10)}; connect again with a new one before then.`,
      });
    }
    const certificateExpiresAt = entry.tlsCertificate === null ? null : certificateExpiry(entry.tlsCertificate);
    if (
      certificateExpiresAt !== null &&
      Date.parse(certificateExpiresAt) - this.now().getTime() < CERTIFICATE_EXPIRY_WARNING_MS
    ) {
      warnings.push({
        code: 'certificate-expiring',
        severity: 'warning',
        message: `LND’s TLS certificate expires on ${certificateExpiresAt.slice(0, 10)}. LND makes a new one when it restarts after that date; connect again with the new tls.cert then.`,
      });
    }
    const channelCount = channels.length + pending.filter((channel) => channel.kind === 'opening').length;
    if (channelCount > 0 && entry.backup?.channels !== channelCount) {
      warnings.push({
        code: 'no-channel-backup',
        severity: 'warning',
        message:
          entry.backup === null
            ? 'BTCortex has not saved a backup of this node’s channels yet. Without one, channel funds are hard to recover after a disk failure.'
            : 'The channels have changed since BTCortex last saved their backup.',
      });
    }
    return warnings;
  }

  // Channel backups

  /** The node's static channel backup as LND exports it, also for BTCortex's backups. */
  async channelBackup(connectionId: string): Promise<{ backup: Uint8Array; channelPoints: number }> {
    const client = await this.clientFor(this.entry(connectionId));
    try {
      return await exportChannelBackup(client);
    } catch (error) {
      throw new AppFailure(this.describe(error));
    }
  }

  async saveChannelBackup(connectionId: string): Promise<ChannelBackupRecord> {
    const entry = this.entry(connectionId);
    const exported = await this.channelBackup(connectionId);
    if (exported.backup.length === 0) {
      throw this.failure('lightning.no-channels', 'The node has no channels to back up yet.');
    }
    const savedAt = this.now();
    const folder = join(this.options.paths.root, 'backups', 'lightning', entry.id);
    mkdirSync(folder, { recursive: true });
    const stamp = savedAt
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d+Z$/, 'Z');
    const path = join(folder, `channel-backup-${stamp}.backup`);
    writeFileSync(path, exported.backup, { flag: 'wx' });
    const record: ChannelBackupRecord = {
      path,
      savedAt: savedAt.toISOString(),
      channels: exported.channelPoints,
      bytes: exported.backup.length,
    };
    this.save(
      this.entries().map((candidate) => (candidate.id === entry.id ? { ...candidate, backup: record } : candidate)),
    );
    this.options.logger.info('Saved a Lightning channel backup', {
      connectionId,
      channels: record.channels,
      bytes: record.bytes,
    });
    return record;
  }
}
