import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { cookieFilePath } from '@btcortex/integration-bitcoin-core';
import { LndRestClient } from '@btcortex/integration-lnd';
import type { RegtestNode } from './regtest-node';
import { freePort } from './regtest-node';

// Disposable LND nodes on a regtest bitcoind for integration tests
// (specification section 31.1), run from the verified installation made by
// scripts/dev/install-lnd.ts. Never on a real network and never with real
// funds: --noseedbackup creates an unencrypted wallet that is thrown away with
// the node, which is acceptable for a test and for nothing else.

export const LND_TEST_RUNTIMES = resolve(import.meta.dirname, '..', '..', '..', '.test-env', 'lnd', 'runtimes');

export function findTestLnd(): string | undefined {
  if (!existsSync(LND_TEST_RUNTIMES)) return undefined;
  for (const version of readdirSync(LND_TEST_RUNTIMES).sort().reverse()) {
    const candidate = join(LND_TEST_RUNTIMES, version, `lnd-windows-amd64-v${version}`, 'lnd.exe');
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export type MacaroonKind = 'admin' | 'readonly' | 'invoice';

export interface LndNode {
  name: string;
  directory: string;
  restAddress: string;
  p2pAddress: string;
  tlsCertificatePath: string;
  tlsCertificate: string;
  macaroonPath(kind: MacaroonKind): string;
  /** Hex, as the REST interface expects it. */
  macaroon(kind: MacaroonKind): string;
  /** A client with the admin macaroon, for setting tests up. */
  admin: LndRestClient;
  pubkey: string;
  stop(): Promise<void>;
}

export async function waitFor<T>(
  probe: () => Promise<T>,
  accept: (value: T) => boolean,
  what: string,
  timeoutMs = 120_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (accept(value)) return value;
      last = value;
    } catch (error) {
      last = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  throw new Error(
    `Timed out waiting for ${what}; last seen: ${last instanceof Error ? last.message : JSON.stringify(last)}`,
  );
}

export interface LndNodeOptions {
  /**
   * Lay the node out as an installation in `<localAppData>\Lnd`, LND's own
   * folder on Windows, with every setting in its lnd.conf, as a user's LND
   * would be.
   */
  localAppData?: string;
}

export async function startLndNode(
  lnd: string,
  bitcoind: RegtestNode,
  name: string,
  options: LndNodeOptions = {},
): Promise<LndNode> {
  const directory =
    options.localAppData === undefined
      ? mkdtempSync(join(tmpdir(), `btcortex-lnd-${name}-`))
      : join(options.localAppData, 'Lnd');
  mkdirSync(directory, { recursive: true });
  const restPort = await freePort();
  const rpcPort = await freePort();
  const p2pPort = await freePort();
  const settings = [
    'bitcoin.regtest=true',
    'bitcoin.node=bitcoind',
    `bitcoind.rpchost=127.0.0.1:${String(bitcoind.rpcPort)}`,
    `bitcoind.rpccookie=${cookieFilePath(bitcoind.dataDirectory, 'regtest')}`,
    'bitcoind.rpcpolling=true',
    'bitcoind.blockpollinginterval=1s',
    'bitcoind.txpollinginterval=1s',
    'noseedbackup=true',
    `restlisten=127.0.0.1:${String(restPort)}`,
    `rpclisten=127.0.0.1:${String(rpcPort)}`,
    `listen=127.0.0.1:${String(p2pPort)}`,
    `alias=${name}`,
    'trickledelay=50',
    'nobootstrap=true',
  ];
  let args: string[];
  if (options.localAppData === undefined) {
    // On the command line, a switch takes no value (go-flags refuses --noseedbackup=true).
    args = [`--lnddir=${directory}`, ...settings.map((setting) => `--${setting.replace(/=true$/, '')}`)];
  } else {
    writeFileSync(
      join(directory, 'lnd.conf'),
      [
        '[Application Options]',
        ...settings.filter((setting) => !setting.startsWith('bitcoin')),
        '',
        '[Bitcoin]',
        ...settings.filter((setting) => setting.startsWith('bitcoin.')),
        '',
        '[Bitcoind]',
        ...settings.filter((setting) => setting.startsWith('bitcoind.')),
        '',
      ].join('\n'),
    );
    args = [`--lnddir=${directory}`];
  }
  const child = spawn(lnd, args, { stdio: 'ignore', windowsHide: true });
  let exited = false;
  const exit = new Promise<void>((resolveExit) => {
    child.once('exit', () => {
      exited = true;
      resolveExit();
    });
  });
  child.once('error', () => undefined);
  // Read through a function, so that a check after an await sees the current value.
  const hasExited = () => exited;

  const networkDirectory = join(directory, 'data', 'chain', 'bitcoin', 'regtest');
  const macaroonPath = (kind: MacaroonKind) => join(networkDirectory, `${kind}.macaroon`);
  const tlsCertificatePath = join(directory, 'tls.cert');
  const restAddress = `127.0.0.1:${String(restPort)}`;
  let admin: LndRestClient | undefined;
  const stop = async () => {
    if (!exited) {
      await admin?.post('/v1/stop').catch(() => undefined);
      const stopped = await Promise.race([
        exit.then(() => true),
        new Promise((resolveTimeout) => {
          setTimeout(() => {
            resolveTimeout(false);
          }, 30_000);
        }),
      ]);
      if (!stopped) child.kill();
      await exit;
    }
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  };

  try {
    await waitFor(
      () => Promise.resolve(existsSync(tlsCertificatePath) && existsSync(macaroonPath('admin'))),
      (ready) => ready || hasExited(),
      `${name}'s certificate and macaroons`,
      60_000,
    );
    if (hasExited()) throw new Error(`lnd (${name}) exited during start-up.`);
    const tlsCertificate = readFileSync(tlsCertificatePath, 'utf8');
    const macaroon = (kind: MacaroonKind) => readFileSync(macaroonPath(kind)).toString('hex');
    admin = new LndRestClient({
      endpoint: { host: '127.0.0.1', port: restPort },
      tlsCertificate,
      macaroon: macaroon('admin'),
    });
    const client = admin;
    const info = await waitFor(
      () => client.get('/v1/getinfo') as Promise<{ synced_to_chain?: boolean; identity_pubkey?: string }>,
      (value) => value.synced_to_chain === true,
      `${name} to sync to the chain`,
    );
    return {
      name,
      directory,
      restAddress,
      p2pAddress: `127.0.0.1:${String(p2pPort)}`,
      tlsCertificatePath,
      tlsCertificate,
      macaroonPath,
      macaroon,
      admin: client,
      pubkey: info.identity_pubkey ?? '',
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

const base64 = (hex: string) => Buffer.from(hex, 'hex').toString('base64');

/** Mines blocks to a fresh address of the given bitcoind wallet. */
export async function mine(bitcoind: RegtestNode, blocks: number, wallet = 'miner'): Promise<void> {
  const address = await bitcoind.client.call<string>('getnewaddress', [], { wallet });
  await bitcoind.client.call('generatetoaddress', [blocks, address]);
}

/** Sends coins from the bitcoind wallet to the node's on-chain wallet and confirms them. */
export async function fund(bitcoind: RegtestNode, node: LndNode, btc: number): Promise<void> {
  const { address } = (await node.admin.get('/v1/newaddress', { type: 'WITNESS_PUBKEY_HASH' })) as { address: string };
  await bitcoind.client.call('sendtoaddress', { address, amount: btc, fee_rate: 2 }, { wallet: 'miner' });
  await mine(bitcoind, 6);
  await waitFor(
    () => node.admin.get('/v1/balance/blockchain') as Promise<{ confirmed_balance?: string }>,
    (balance) => Number(balance.confirmed_balance ?? 0) >= btc * 1e8,
    `${node.name}'s funds to confirm`,
  );
}

export async function connectPeers(from: LndNode, to: LndNode): Promise<void> {
  await from.admin.post('/v1/peers', { addr: { pubkey: to.pubkey, host: to.p2pAddress }, perm: false, timeout: '30' });
}

/** Opens a channel and returns its funding transaction id and output, without confirming it. */
export async function openChannel(
  from: LndNode,
  to: LndNode,
  sats: number,
  pushSats = 0,
): Promise<{ txid: string; vout: number }> {
  const request = async () =>
    (await from.admin.post('/v1/channels', {
      node_pubkey: base64(to.pubkey),
      local_funding_amount: String(sats),
      push_sat: String(pushSats),
      sat_per_vbyte: '2',
    })) as { funding_txid_bytes: string; output_index?: number };
  // LND refuses while its wallet catches up with blocks mined a moment ago (for another node's funds).
  const deadline = Date.now() + 60_000;
  let point: Awaited<ReturnType<typeof request>>;
  for (;;) {
    try {
      point = await request();
      break;
    } catch (error) {
      if (!(error instanceof Error && error.message.includes('fully synced')) || Date.now() > deadline) throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
    }
  }
  // The REST interface gives the txid's bytes in internal (reversed) order.
  const txid = Buffer.from(point.funding_txid_bytes, 'base64').reverse().toString('hex');
  return { txid, vout: point.output_index ?? 0 };
}

export async function addInvoice(node: LndNode, sats: number, memo: string): Promise<string> {
  const invoice = (await node.admin.post('/v1/invoices', { value: String(sats), memo })) as { payment_request: string };
  return invoice.payment_request;
}

/** Pays an invoice and resolves once the payment has succeeded (or rejects when it fails). */
export async function payInvoice(node: LndNode, paymentRequest: string): Promise<{ status: string }> {
  const payment = (await node.admin.stream(
    '/v2/router/send',
    { payment_request: paymentRequest, timeout_seconds: 60, fee_limit_sat: '1000' },
    (result) => ['SUCCEEDED', 'FAILED'].includes((result as { status?: string }).status ?? ''),
  )) as { status: string; failure_reason?: string };
  if (payment.status !== 'SUCCEEDED') throw new Error(`The payment failed: ${payment.failure_reason ?? 'unknown'}`);
  return payment;
}

/** Waits until the node can find a route to another, once gossip has carried the channels' policies. */
export async function waitForRoute(from: LndNode, to: LndNode, sats: number): Promise<void> {
  await waitFor(
    () => from.admin.get(`/v1/graph/routes/${to.pubkey}/${String(sats)}`) as Promise<{ routes?: unknown[] }>,
    (answer) => (answer.routes?.length ?? 0) > 0,
    `${from.name} to find a route to ${to.name}`,
    180_000,
  );
}
