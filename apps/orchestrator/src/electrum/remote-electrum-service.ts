import { randomUUID } from 'node:crypto';
import { connect as connectTcp, isIP } from 'node:net';
import type { Socket } from 'node:net';
import { checkServerIdentity, connect as connectTls } from 'node:tls';
import type { TLSSocket } from 'node:tls';
import { z } from 'zod';
import { AppFailure, isLocalNetworkHost, networkOfGenesis, RemoteElectrumServerSchema } from '@btcortex/contracts';
import type {
  AddRemoteElectrumParams,
  NodeWithStatus,
  RemoteElectrumEndpoint,
  RemoteElectrumServer,
  RemoteElectrumStatus,
  RemoteElectrumTest,
  RemoteElectrumWithStatus,
  ServerCertificate,
} from '@btcortex/contracts';
import type { BitcoinRpcClient } from '@btcortex/bitcoin-rpc';
import { probeElectrumServer } from '@btcortex/integration-fulcrum';
import { connectThroughSocks } from '@btcortex/integration-tor';
import type { Logger } from '../logging/logger';
import type { SettingsStore } from '../persistence/settings';
import { isOnionHost } from '@btcortex/core';

// Electrum servers on other computers (specification sections 7 and 37,
// phase 5): electrs, Fulcrum or ElectrumX on a node platform or another
// machine, reached directly or through BTCortex's tor, over TCP or TLS. A
// certificate is trusted when Windows' authorities vouch for it, or when it
// is the very one the user accepted after seeing it; anything else is
// refused before a request is sent. Such a server is read — its software,
// chain and height checked every minute — and may answer a node's address
// lookups when the node has no Electrum server of its own. It is never
// managed.

const SETTINGS_KEY = 'electrum.remote';
const CHECK_EVERY_MS = 60_000;
/** Tor circuits can take their time. */
const CONNECT_TIMEOUT_MS = 30_000;
const MAX_SERVERS = 20;
const COMPONENT = 'Electrum servers';

export interface RemoteElectrumOptions {
  settings: Pick<SettingsStore, 'get' | 'set'>;
  nodes: { get(nodeId: string): NodeWithStatus; rpc(nodeId: string): Pick<BitcoinRpcClient, 'call'> };
  /** BTCortex's tor's SOCKS port for programs, while it runs. */
  socksPort: () => number | undefined;
  logger: Logger;
  now?: () => Date;
  /** How a plain TCP connection is made; replaced in tests. */
  connect?: (host: string, port: number) => Promise<Socket>;
}

function connectPlain(host: string, port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connectTcp({ host, port });
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => {
      socket.destroy(new Error('No answer within 30 seconds.'));
    });
    socket.once('connect', () => {
      socket.setTimeout(0);
      socket.removeAllListeners('error');
      resolve(socket);
    });
    socket.once('error', reject);
  });
}

const describe = (value: unknown) => (typeof value === 'string' ? value : Array.isArray(value) ? value.join(', ') : '');

/**
 * Why a certificate is not trusted, in words: an expired certificate or one
 * for another name says so; one no authority vouches for is what a server of
 * your own usually presents, which you can compare and accept when adding it.
 */
function untrustedReason(authorizationError: unknown): string {
  // Node.js gives the reason as a code string or as an Error carrying one.
  const code =
    typeof authorizationError === 'string'
      ? authorizationError
      : authorizationError instanceof Error
        ? ((authorizationError as Error & { code?: string }).code ?? authorizationError.message)
        : '';
  if (code === 'CERT_HAS_EXPIRED') return 'The server’s certificate has expired.';
  if (code === 'CERT_NOT_YET_VALID') return 'The server’s certificate is not valid yet: check this computer’s clock.';
  if (code === 'ERR_TLS_CERT_ALTNAME_INVALID' || /altname|hostname/i.test(code)) {
    return 'The server’s certificate was issued for another name.';
  }
  return 'No authority this computer trusts vouches for this certificate, as is usual for a server of your own. Compare its fingerprint with the one your server shows before you accept it.';
}

/**
 * The height at which a server's block is compared with the node's: two below
 * the lower tip, so that a block found a moment ago on one side only does not
 * count as another chain. Undefined when the node does not answer.
 */
export function recentCommonHeight(serverHeight: number, nodeHeight: number | undefined): number | undefined {
  if (nodeHeight === undefined) return undefined;
  return Math.max(0, Math.min(serverHeight, nodeHeight) - 2);
}

export class RemoteElectrumService {
  private servers: RemoteElectrumServer[];
  private readonly statuses = new Map<string, RemoteElectrumStatus>();
  private timer: NodeJS.Timeout | undefined;
  private checking: Promise<void> | undefined;

  constructor(private readonly options: RemoteElectrumOptions) {
    this.servers = options.settings.get(SETTINGS_KEY, z.array(RemoteElectrumServerSchema)) ?? [];
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private failure(code: string, message: string): AppFailure {
    return new AppFailure({ code, message, component: COMPONENT, dataRisk: 'none', recoveryActions: [] });
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.checkAll();
    }, CHECK_EVERY_MS);
    this.timer.unref();
    void this.checkAll();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /**
   * A connection to the server, through tor when asked and secured when asked.
   * `pinned`: the certificate the user accepted; `inspect`: return whatever
   * certificate is presented, so that it can be shown before it is accepted.
   */
  private async open(
    endpoint: RemoteElectrumEndpoint,
    pinned: string | null,
    inspect = false,
  ): Promise<{ socket: Socket; certificate: ServerCertificate | null }> {
    const onion = isOnionHost(endpoint.host);
    // Unencrypted only where nobody on the internet is in between: this network, or an onion service.
    if (!endpoint.tls && !onion && !isLocalNetworkHost(endpoint.host)) {
      throw this.failure(
        'electrum.remote.plain-internet',
        'Without TLS, the addresses BTCortex looks up and the answers would cross the internet in clear, where anyone on the way could read or change them. Turn on TLS (port 50002 on most servers), or use the server’s onion address through Tor.',
      );
    }
    if (onion && endpoint.via !== 'tor') {
      throw this.failure(
        'electrum.remote.onion-needs-tor',
        'Onion addresses are reached through Tor: choose “through Tor”.',
      );
    }
    let socket: Socket;
    if (endpoint.via === 'tor') {
      const proxyPort = this.options.socksPort();
      if (proxyPort === undefined) {
        throw this.failure(
          'electrum.remote.tor-not-running',
          'BTCortex’s tor is not running: start it on the Tor & Privacy page.',
        );
      }
      socket = await connectThroughSocks(
        { host: endpoint.host, port: endpoint.port },
        { proxyPort, isolation: `electrum-${endpoint.host}`, timeoutMs: CONNECT_TIMEOUT_MS },
      );
    } else {
      socket = await (this.options.connect ?? connectPlain)(endpoint.host, endpoint.port);
    }
    if (!endpoint.tls) return { socket, certificate: null };

    const plain = socket;
    const secured = await new Promise<TLSSocket>((resolve, reject) => {
      const connection = connectTls({
        socket: plain,
        ...(isIP(endpoint.host) === 0 && !onion ? { servername: endpoint.host } : {}),
        // Checked below, before anything is sent: by Windows' authorities, or against the accepted certificate.
        rejectUnauthorized: false,
      });
      connection.setTimeout(CONNECT_TIMEOUT_MS, () => {
        connection.destroy(new Error('The TLS handshake took too long.'));
      });
      connection.once('secureConnect', () => {
        connection.setTimeout(0);
        resolve(connection);
      });
      connection.once('error', (error) => {
        plain.destroy();
        reject(error);
      });
    });
    const peer = secured.getPeerCertificate();
    const certificate: ServerCertificate = {
      fingerprint: peer.fingerprint256.toUpperCase(),
      subject: describe(peer.subject.CN) || describe(peer.subject.O) || 'unnamed',
      issuer: describe(peer.issuer.CN) || describe(peer.issuer.O) || 'unnamed',
      validFrom: peer.valid_from,
      validTo: peer.valid_to,
      publiclyTrusted: secured.authorized && !onion && checkServerIdentity(endpoint.host, peer) === undefined,
    };
    if (!inspect) {
      const trusted = pinned !== null ? certificate.fingerprint === pinned : certificate.publiclyTrusted;
      if (!trusted) {
        secured.destroy();
        throw pinned !== null
          ? this.failure(
              'electrum.remote.certificate-changed',
              'The server presented a different certificate from the one you accepted. If it changed its certificate, remove the server and add it again; otherwise someone may be in between.',
            )
          : this.failure('electrum.remote.certificate-untrusted', untrustedReason(secured.authorizationError));
      }
    }
    return { socket: secured, certificate };
  }

  async test(endpoint: RemoteElectrumEndpoint): Promise<RemoteElectrumTest> {
    let certificate: ServerCertificate | null = null;
    try {
      const opened = await this.open(endpoint, null, true);
      certificate = opened.certificate;
      const probe = await probeElectrumServer({
        host: endpoint.host,
        port: endpoint.port,
        timeoutMs: CONNECT_TIMEOUT_MS,
        socket: () => Promise.resolve(opened.socket),
      });
      return {
        reachable: true,
        serverVersion: probe.serverVersion,
        protocolVersion: probe.protocolVersion,
        genesisHash: probe.genesisHash,
        network: probe.genesisHash === null ? null : networkOfGenesis(probe.genesisHash),
        height: probe.height,
        certificate,
        error: null,
      };
    } catch (error) {
      return {
        reachable: false,
        serverVersion: null,
        protocolVersion: null,
        genesisHash: null,
        network: null,
        height: null,
        certificate,
        error:
          error instanceof AppFailure ? error.error.message : error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async nodeGenesis(nodeId: string): Promise<string> {
    return this.options.nodes.rpc(nodeId).call<string>('getblockhash', [0]);
  }

  /** The node's height, when it answers; recent blocks are compared only then. */
  private async nodeHeight(nodeId: string | null): Promise<number | undefined> {
    if (nodeId === null) return undefined;
    return this.options.nodes
      .rpc(nodeId)
      .call<number>('getblockcount')
      .catch(() => undefined);
  }

  /**
   * Whether the server's block near the lower of the two tips is the node's:
   * Bitcoin Knots since 29.4.1 shares Bitcoin Core's genesis block but not its
   * later blocks, so the genesis block alone cannot tell the chains apart.
   */
  private async sameRecentBlock(nodeId: string, block: { height: number; hash: string } | undefined): Promise<boolean> {
    if (!block) return true;
    const hash = await this.options.nodes
      .rpc(nodeId)
      .call<string>('getblockhash', [block.height])
      .catch(() => undefined);
    return hash === undefined || hash === block.hash;
  }

  async add(params: AddRemoteElectrumParams): Promise<RemoteElectrumWithStatus[]> {
    if (this.servers.length >= MAX_SERVERS) {
      throw this.failure(
        'electrum.remote.too-many',
        `BTCortex reads at most ${String(MAX_SERVERS)} Electrum servers on other computers.`,
      );
    }
    const duplicate = this.servers.find(
      (server) => server.host.toLowerCase() === params.host.toLowerCase() && server.port === params.port,
    );
    if (duplicate) throw this.failure('electrum.remote.duplicate', `${duplicate.name} already reads this server.`);
    const endpoint: RemoteElectrumEndpoint = { host: params.host, port: params.port, tls: params.tls, via: params.via };
    const opened = await this.open(endpoint, params.tls ? params.certificateFingerprint : null);
    const nodeHeight = await this.nodeHeight(params.nodeId);
    const probe = await probeElectrumServer({
      host: params.host,
      port: params.port,
      timeoutMs: CONNECT_TIMEOUT_MS,
      socket: () => Promise.resolve(opened.socket),
      blockAt: (serverHeight) => recentCommonHeight(serverHeight, nodeHeight),
    });
    if (params.nodeId !== null) {
      const node = this.options.nodes.get(params.nodeId);
      if (
        probe.genesisHash === null ||
        probe.genesisHash !== (await this.nodeGenesis(params.nodeId)) ||
        !(await this.sameRecentBlock(params.nodeId, probe.block))
      ) {
        throw this.failure(
          'electrum.remote.wrong-chain',
          `This server follows another chain from ${node.profile.name}, so it cannot answer its address lookups.`,
        );
      }
    }
    const server: RemoteElectrumServer = {
      id: randomUUID(),
      name: params.name,
      host: params.host,
      port: params.port,
      tls: params.tls,
      via: params.via,
      certificateFingerprint: params.tls
        ? opened.certificate?.publiclyTrusted
          ? null
          : params.certificateFingerprint
        : null,
      nodeId: params.nodeId,
      addedAt: this.now().toISOString(),
    };
    this.servers = [...this.servers, server];
    this.options.settings.set(SETTINGS_KEY, this.servers);
    this.statuses.set(server.id, {
      state: 'online',
      serverVersion: probe.serverVersion,
      network: probe.genesisHash === null ? null : networkOfGenesis(probe.genesisHash),
      height: probe.height,
      checkedAt: this.now().toISOString(),
      error: null,
      unreachableSince: null,
    });
    this.options.logger.info('Added an Electrum server on another computer', {
      id: server.id,
      via: server.via,
      tls: server.tls,
    });
    return this.list();
  }

  remove(id: string): RemoteElectrumWithStatus[] {
    this.servers = this.servers.filter((server) => server.id !== id);
    this.statuses.delete(id);
    this.options.settings.set(SETTINGS_KEY, this.servers);
    return this.list();
  }

  list(): RemoteElectrumWithStatus[] {
    return this.servers.map((server) => ({
      server,
      status: this.statuses.get(server.id) ?? {
        state: 'unknown',
        serverVersion: null,
        network: null,
        height: null,
        checkedAt: null,
        error: null,
        unreachableSince: null,
      },
    }));
  }

  private async check(server: RemoteElectrumServer): Promise<void> {
    const previous = this.statuses.get(server.id);
    const checkedAt = this.now().toISOString();
    try {
      const opened = await this.open(server, server.tls ? server.certificateFingerprint : null);
      const nodeHeight = await this.nodeHeight(server.nodeId);
      const probe = await probeElectrumServer({
        host: server.host,
        port: server.port,
        timeoutMs: CONNECT_TIMEOUT_MS,
        socket: () => Promise.resolve(opened.socket),
        blockAt: (serverHeight) => recentCommonHeight(serverHeight, nodeHeight),
      });
      const wrongChain =
        server.nodeId !== null &&
        (probe.genesisHash === null ||
          probe.genesisHash !== (await this.nodeGenesis(server.nodeId).catch(() => probe.genesisHash)) ||
          !(await this.sameRecentBlock(server.nodeId, probe.block)));
      this.statuses.set(server.id, {
        state: wrongChain ? 'wrong-chain' : 'online',
        serverVersion: probe.serverVersion,
        network: probe.genesisHash === null ? null : networkOfGenesis(probe.genesisHash),
        height: probe.height,
        checkedAt,
        error: wrongChain ? 'It follows another chain from the node it was added for.' : null,
        unreachableSince: null,
      });
    } catch (error) {
      // A server added with a certificate an authority vouched for that now presents one no authority
      // vouches for has changed its certificate just as much as a pinned one: someone may be in between.
      const changed =
        error instanceof AppFailure &&
        (error.error.code === 'electrum.remote.certificate-changed' ||
          error.error.code === 'electrum.remote.certificate-untrusted');
      this.statuses.set(server.id, {
        state: changed ? 'certificate-changed' : 'unreachable',
        serverVersion: previous?.serverVersion ?? null,
        network: previous?.network ?? null,
        height: previous?.height ?? null,
        checkedAt,
        error:
          error instanceof AppFailure ? error.error.message : error instanceof Error ? error.message : String(error),
        unreachableSince: previous?.unreachableSince ?? checkedAt,
      });
    }
  }

  /** Checks one server now, as the Remote infrastructure page's test does. */
  async checkOne(id: string): Promise<RemoteElectrumStatus> {
    const server = this.servers.find((candidate) => candidate.id === id);
    if (!server)
      throw this.failure('electrum.remote.unknown', 'This Electrum server is not known, or no longer exists.');
    await this.check(server);
    const status = this.statuses.get(id);
    if (!status) throw this.failure('electrum.remote.unknown', 'This Electrum server could not be checked.');
    return status;
  }

  /** Checks every server; one round at a time. */
  checkAll(): Promise<void> {
    this.checking ??= (async () => {
      for (const server of this.servers) await this.check(server);
    })().finally(() => {
      this.checking = undefined;
    });
    return this.checking;
  }

  /** A way to reach an online server added for this node, for its address lookups. */
  lookupFor(nodeId: string): { name: string; open: () => Promise<Socket> } | undefined {
    const server = this.servers.find(
      (candidate) => candidate.nodeId === nodeId && this.statuses.get(candidate.id)?.state === 'online',
    );
    if (!server) return undefined;
    return {
      name: server.name,
      open: async () => (await this.open(server, server.tls ? server.certificateFingerprint : null)).socket,
    };
  }
}
