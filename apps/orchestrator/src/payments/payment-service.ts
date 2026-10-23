import { randomUUID } from 'node:crypto';
import type { Duplex } from 'node:stream';
import { z } from 'zod';
import { AppFailure, isLocalNetworkHost } from '@btcortex/contracts';
import type {
  AddPaymentServerParams,
  AppError,
  PaymentDashboard,
  PaymentInvoice,
  PaymentInvoiceStatus,
  PaymentServer,
  PaymentServerStatus,
  PaymentServerVia,
  PaymentServerWithStatus,
  PaymentStore,
} from '@btcortex/contracts';
import { GreenfieldClient, GreenfieldError, GreenfieldTransportError } from '@btcortex/integration-btcpay';
import type { GreenfieldClientOptions, GreenfieldInvoice } from '@btcortex/integration-btcpay';
import { connectThroughSocks } from '@btcortex/integration-tor';
import type { Logger } from '../logging/logger';
import type { SettingsStore } from '../persistence/settings';
import type { SecretVault } from '../vault/vault';
import { isOnionHost } from '@btcortex/core';

// Payments & merchants (specification section 13): BTCPay Server
// installations BTCortex connects to through the Greenfield API, with a
// read-only API key kept in the DPAPI vault. Each server is checked once a
// minute (health, then server information with the key); a store's payment
// methods, on-chain balance and invoices are read when the page asks, and
// whatever the key may not read is reported as such rather than as a failure.

const SETTINGS_KEY = 'payments.servers';
const CHECK_EVERY_MS = 60_000;
const DASHBOARD_REUSE_MS = 60_000;
const RECENT_INVOICES = 10;
const WINDOW_DAYS = 30;
/** Invoices read per store for the 30-day summary. */
const WINDOW_LIMIT = 500;
const MAX_STORES = 20;
const STATUSES: readonly PaymentInvoiceStatus[] = ['New', 'Processing', 'Settled', 'Expired', 'Invalid'];

const StoredSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    url: z.string(),
    via: z.enum(['direct', 'tor']),
    secretId: z.string(),
    addedAt: z.string(),
  }),
);
type Stored = z.infer<typeof StoredSchema>[number];

/** What the service needs of a Greenfield client; tests replace it. */
export type Greenfield = Pick<
  GreenfieldClient,
  'health' | 'serverInfo' | 'stores' | 'invoices' | 'paymentMethods' | 'wallet'
>;

export interface PaymentServiceOptions {
  settings: SettingsStore;
  vault: Pick<SecretVault, 'store' | 'reveal' | 'remove'>;
  /** BTCortex's tor for applications, when it runs. */
  torSocksPort: () => number | undefined;
  logger: Logger;
  now?: () => Date;
  client?: (options: GreenfieldClientOptions) => Greenfield;
}

/** Exact decimal addition of BTCPay's amount strings. */
export function addDecimal(a: string, b: string): string {
  const parse = (value: string) => {
    const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(value.trim());
    if (!match) return undefined;
    const whole = match[2] ?? '';
    return { negative: match[1] === '-', whole: whole === '' ? '0' : whole, fraction: match[3] ?? '' };
  };
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return a;
  const scale = Math.max(left.fraction.length, right.fraction.length);
  const toInteger = (value: NonNullable<ReturnType<typeof parse>>) =>
    (value.negative ? -1n : 1n) * BigInt(`${value.whole}${value.fraction.padEnd(scale, '0')}`);
  const sum = toInteger(left) + toInteger(right);
  const negative = sum < 0n;
  const digits = (negative ? -sum : sum).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const fraction = scale > 0 ? `.${digits.slice(digits.length - scale)}` : '';
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

/** The address rules: HTTPS, or plain HTTP only on the local network or to an onion service through Tor. */
export function checkServerAddress(url: string, via: PaymentServerVia): { url: string; via: PaymentServerVia } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw invalid('This is not a web address. It looks like https://pay.example.com.');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw invalid('A BTCPay Server address starts with https://.');
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw invalid('Leave the user name and password out of the address; BTCortex signs in with the API key.');
  }
  const onion = isOnionHost(parsed.hostname);
  if (onion && via !== 'tor') throw invalid('An onion address is reached through Tor; choose Tor.');
  if (parsed.protocol === 'http:' && !onion && !isLocalNetworkHost(parsed.hostname)) {
    throw invalid(
      'Plain http:// would send the API key and your sales in clear across the internet. Use the https:// address, or the onion address through Tor.',
    );
  }
  parsed.search = '';
  parsed.hash = '';
  return { url: parsed.toString().replace(/\/+$/, ''), via };
}

function invalid(message: string): AppFailure {
  return new AppFailure({
    code: 'payments.invalid-address',
    message,
    component: 'Payments',
    dataRisk: 'none',
    recoveryActions: [],
  });
}

function emptyStatus(serverId: string): PaymentServerStatus {
  return {
    serverId,
    state: 'checking',
    checkedAt: null,
    version: null,
    onion: null,
    chains: [],
    error: null,
    unreachableSince: null,
  };
}

function toInvoice(invoice: GreenfieldInvoice): PaymentInvoice {
  return {
    id: invoice.id,
    status: invoice.status,
    additionalStatus: invoice.additionalStatus ?? null,
    amount: invoice.amount,
    paidAmount: invoice.paidAmount ?? null,
    currency: invoice.currency,
    createdAt: new Date(invoice.createdTime * 1000).toISOString(),
    expiresAt: invoice.expirationTime ? new Date(invoice.expirationTime * 1000).toISOString() : null,
    orderId: invoice.metadata?.orderId ?? null,
    checkoutLink: invoice.checkoutLink ?? null,
  };
}

/** Undefined when the key may not read this; other failures propagate. */
async function permitted<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof GreenfieldError && (error.kind === 'permission' || error.kind === 'not-found'))
      return undefined;
    throw error;
  }
}

export class PaymentService {
  private readonly statuses = new Map<string, PaymentServerStatus>();
  private readonly dashboards = new Map<string, { at: number; value: Promise<PaymentDashboard> }>();
  private timer: NodeJS.Timeout | undefined;
  private checking = false;

  constructor(private readonly options: PaymentServiceOptions) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private entries(): Stored[] {
    return this.options.settings.get(SETTINGS_KEY, StoredSchema) ?? [];
  }

  private save(entries: Stored[]): void {
    this.options.settings.set(SETTINGS_KEY, entries);
  }

  private failure(code: string, message: string, extra: Partial<AppError> = {}): AppFailure {
    return new AppFailure({
      code,
      message,
      component: 'Payments',
      dataRisk: 'none',
      recoveryActions: [],
      ...extra,
    });
  }

  initialise(): void {
    const tick = () => {
      void this.checkAll().finally(() => {
        this.timer = setTimeout(tick, CHECK_EVERY_MS);
        this.timer.unref();
      });
    };
    this.timer = setTimeout(tick, 5_000);
    this.timer.unref();
  }

  shutdown(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  list(): PaymentServerWithStatus[] {
    return this.entries().map((entry) => ({
      server: this.publicServer(entry),
      status: this.statuses.get(entry.id) ?? emptyStatus(entry.id),
    }));
  }

  private publicServer(entry: Stored): PaymentServer {
    return { id: entry.id, kind: 'btcpay', name: entry.name, url: entry.url, via: entry.via, addedAt: entry.addedAt };
  }

  private client(url: string, via: PaymentServerVia, apiKey: string, isolation: string): Greenfield {
    let connect: ((target: { host: string; port: number }) => Promise<Duplex>) | undefined;
    if (via === 'tor') {
      const socksPort = this.options.torSocksPort();
      if (socksPort === undefined) {
        throw this.failure(
          'payments.tor-needed',
          'This server is reached through Tor, and BTCortex’s tor is not running.',
          {
            recoveryActions: [{ id: 'open-tor', label: 'Open Tor & Privacy' }],
          },
        );
      }
      connect = (target) => connectThroughSocks(target, { proxyPort: socksPort, isolation });
    }
    const options: GreenfieldClientOptions = {
      baseUrl: url,
      apiKey,
      timeoutMs: via === 'tor' ? 60_000 : 15_000,
      ...(connect ? { connect } : {}),
    };
    return this.options.client?.(options) ?? new GreenfieldClient(options);
  }

  private async clientFor(entry: Stored): Promise<Greenfield> {
    const apiKey = await this.options.vault.reveal(entry.secretId);
    return this.client(entry.url, entry.via, apiKey, `btcortex-payments-${entry.id}`);
  }

  /** What went wrong, in words for the person and for the monitoring. */
  private describe(error: unknown, name: string): { state: 'unreachable' | 'unauthorised'; message: string } {
    if (error instanceof GreenfieldError && error.kind === 'auth') {
      return {
        state: 'unauthorised',
        message: `${name} refused the API key: it was deleted or its user lost access. Create a new key in BTCPay and connect again.`,
      };
    }
    if (error instanceof GreenfieldError) {
      return { state: 'unreachable', message: `${name} answered with an error: ${error.message}` };
    }
    if (error instanceof GreenfieldTransportError) return { state: 'unreachable', message: error.message };
    if (error instanceof AppFailure) return { state: 'unreachable', message: error.error.message };
    return { state: 'unreachable', message: `${name} could not be reached.` };
  }

  private async probe(client: Greenfield, name: string, previous: PaymentServerStatus | undefined, serverId: string) {
    const now = this.now();
    try {
      await client.health();
      const info = await client.serverInfo();
      const status: PaymentServerStatus = {
        serverId,
        state: info.fullySynched ? 'online' : 'synchronising',
        checkedAt: now.toISOString(),
        version: info.version,
        onion: info.onion ?? null,
        chains: info.syncStatus.map((chain) => ({
          paymentMethodId: chain.paymentMethodId ?? 'BTC-CHAIN',
          chainHeight: chain.chainHeight ?? null,
          syncHeight: chain.syncHeight ?? null,
          available: chain.available ?? false,
        })),
        error: null,
        unreachableSince: null,
      };
      return { status, error: undefined };
    } catch (error) {
      const described = this.describe(error, name);
      const status: PaymentServerStatus = {
        ...(previous ?? emptyStatus(serverId)),
        serverId,
        state: described.state,
        checkedAt: now.toISOString(),
        error: described.message,
        unreachableSince: previous?.unreachableSince ?? now.toISOString(),
      };
      return { status, error };
    }
  }

  private async checkAll(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    try {
      for (const entry of this.entries()) {
        try {
          const client = await this.clientFor(entry);
          const { status } = await this.probe(client, entry.name, this.statuses.get(entry.id), entry.id);
          this.statuses.set(entry.id, status);
        } catch (error) {
          const previous = this.statuses.get(entry.id);
          const described = this.describe(error, entry.name);
          this.statuses.set(entry.id, {
            ...(previous ?? emptyStatus(entry.id)),
            state: described.state,
            checkedAt: this.now().toISOString(),
            error: described.message,
            unreachableSince: previous?.unreachableSince ?? this.now().toISOString(),
          });
        }
      }
    } finally {
      this.checking = false;
    }
  }

  /** Checks one server now and keeps the result, as the minute's check would. */
  async test(serverId: string): Promise<PaymentServerStatus> {
    const entry = this.entries().find((candidate) => candidate.id === serverId);
    if (!entry) throw this.failure('payments.not-found', 'This BTCPay Server connection no longer exists.');
    const client = await this.clientFor(entry);
    const { status } = await this.probe(client, entry.name, this.statuses.get(entry.id), entry.id);
    this.statuses.set(entry.id, status);
    return status;
  }

  async add(params: AddPaymentServerParams): Promise<PaymentServerWithStatus> {
    const { url, via } = checkServerAddress(params.url, params.via);
    if (this.entries().some((entry) => entry.url.toLowerCase() === url.toLowerCase())) {
      throw this.failure('payments.duplicate', 'BTCortex already connects to this BTCPay Server.');
    }
    const id = randomUUID();
    const client = this.client(url, via, params.apiKey, `btcortex-payments-${id}`);
    // Tested before anything is kept: the address, the key, and that it can at least list stores.
    const { status, error } = await this.probe(client, params.name, undefined, id);
    if (error !== undefined) {
      throw this.failure('payments.connection-failed', status.error ?? 'BTCPay Server could not be reached.', {
        likelyCause:
          status.state === 'unauthorised'
            ? 'The API key is wrong, or it was deleted.'
            : 'The address is wrong, the server is down, or this network blocks it.',
        recoveryActions: [{ id: 'check-address', label: 'Check the address and the API key' }],
      });
    }
    const stores = await permitted(() => client.stores());
    if (stores === undefined) {
      throw this.failure(
        'payments.permission-missing',
        'The API key may not list the stores. Create a key with the permissions BTCortex names; none of them can spend or change anything.',
        { recoveryActions: [{ id: 'create-key', label: 'Create a read-only key in BTCPay' }] },
      );
    }
    const secretId = await this.options.vault.store(`BTCPay Server API key (${params.name})`, params.apiKey);
    const entry: Stored = { id, name: params.name, url, via, secretId, addedAt: this.now().toISOString() };
    this.save([...this.entries(), entry]);
    this.statuses.set(id, status);
    this.options.logger.info('Connected to a BTCPay Server', {
      serverId: id,
      version: status.version,
      stores: stores.length,
      via,
    });
    return { server: this.publicServer(entry), status };
  }

  remove(serverId: string): void {
    const entry = this.entries().find((candidate) => candidate.id === serverId);
    if (!entry) throw this.failure('payments.not-found', 'This BTCPay Server connection no longer exists.');
    this.save(this.entries().filter((candidate) => candidate.id !== serverId));
    this.statuses.delete(serverId);
    this.dashboards.delete(serverId);
    if (!this.options.vault.remove(entry.secretId)) {
      this.options.logger.warn('The API key was not in the vault any more', { serverId });
    }
    this.options.logger.info('Forgot a BTCPay Server connection', { serverId });
  }

  dashboard(serverId: string, refresh: boolean): Promise<PaymentDashboard> {
    const now = this.now().getTime();
    const cached = this.dashboards.get(serverId);
    if (!refresh && cached && now - cached.at < DASHBOARD_REUSE_MS) return cached.value;
    const value = this.readDashboard(serverId);
    this.dashboards.set(serverId, { at: now, value });
    value.catch(() => {
      if (this.dashboards.get(serverId)?.value === value) this.dashboards.delete(serverId);
    });
    return value;
  }

  private async readDashboard(serverId: string): Promise<PaymentDashboard> {
    const entry = this.entries().find((candidate) => candidate.id === serverId);
    if (!entry) throw this.failure('payments.not-found', 'This BTCPay Server connection no longer exists.');
    const client = await this.clientFor(entry);
    const permissions = { stores: true, invoices: true, wallet: true };
    try {
      const stores = await permitted(() => client.stores());
      if (stores === undefined) {
        return {
          serverId,
          checkedAt: this.now().toISOString(),
          stores: [],
          permissions: { stores: false, invoices: false, wallet: false },
        };
      }
      const since = Math.floor(this.now().getTime() / 1000) - WINDOW_DAYS * 24 * 60 * 60;
      const summaries: PaymentStore[] = [];
      for (const store of stores.slice(0, MAX_STORES)) {
        const methods = await permitted(() => client.paymentMethods(store.id));
        const onChain = methods?.find((method) => method.paymentMethodId === 'BTC-CHAIN' && method.enabled);
        let balance: PaymentStore['balance'] = null;
        if (onChain) {
          const wallet = await permitted(() => client.wallet(store.id, 'BTC-CHAIN'));
          if (wallet === undefined) permissions.wallet = false;
          else
            balance = {
              total: wallet.balance,
              confirmed: wallet.confirmedBalance,
              unconfirmed: wallet.unconfirmedBalance,
            };
        }
        const window = await permitted(() => client.invoices(store.id, { startDate: since, take: WINDOW_LIMIT }));
        let invoices: PaymentStore['invoices'] = null;
        if (window === undefined) permissions.invoices = false;
        else {
          const counts = Object.fromEntries(STATUSES.map((status) => [status, 0])) as Record<
            PaymentInvoiceStatus,
            number
          >;
          const settled = new Map<string, string>();
          for (const invoice of window) {
            counts[invoice.status] += 1;
            if (invoice.status === 'Settled') {
              settled.set(invoice.currency, addDecimal(settled.get(invoice.currency) ?? '0', invoice.amount));
            }
          }
          invoices = {
            recent: [...window]
              .sort((a, b) => b.createdTime - a.createdTime)
              .slice(0, RECENT_INVOICES)
              .map(toInvoice),
            counts,
            settled: [...settled].map(([currency, amount]) => ({ currency, amount })),
            complete: window.length < WINDOW_LIMIT,
          };
        }
        summaries.push({
          id: store.id,
          name: store.name,
          currency: store.defaultCurrency ?? null,
          archived: store.archived ?? false,
          paymentMethods: methods?.map((method) => ({ id: method.paymentMethodId, enabled: method.enabled })) ?? null,
          balance,
          invoices,
        });
      }
      return { serverId, checkedAt: this.now().toISOString(), stores: summaries, permissions };
    } catch (error) {
      const described = this.describe(error, entry.name);
      throw this.failure('payments.unavailable', described.message, {
        recoveryActions: [{ id: 'retry', label: 'Try again' }],
      });
    }
  }
}
