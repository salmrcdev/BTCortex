// Risk classes of Bitcoin Core 31.1's RPC methods, from
// docs/research/notes/full-nodes-core.md §7.3 (specification section 5.7),
// and of the methods Bitcoin Knots 29.4.2 adds, including the legacy-wallet
// methods Bitcoin Core had before 30. src/testdata holds both nodes' `help`.
//
// - read: no side effects.
// - heavy: read-only but slow; runs with a long timeout.
// - state: changes node or wallet state, low risk.
// - dangerous: irreversible, broadcasts or moves funds, manipulates the chain,
//   deletes data or writes files on the node's computer; needs explicit
//   confirmation and is unavailable in read-only mode.
// `secret` marks methods whose parameters or results can hold secrets: their
// parameters are never logged or kept in the history.

export type RpcRisk = 'read' | 'heavy' | 'state' | 'dangerous';

export interface RpcMethodRisk {
  risk: RpcRisk;
  secret: boolean;
}

const R: RpcMethodRisk = { risk: 'read', secret: false };
const H: RpcMethodRisk = { risk: 'heavy', secret: false };
const S: RpcMethodRisk = { risk: 'state', secret: false };
const D: RpcMethodRisk = { risk: 'dangerous', secret: false };
const RK: RpcMethodRisk = { risk: 'read', secret: true };
const SK: RpcMethodRisk = { risk: 'state', secret: true };
const DK: RpcMethodRisk = { risk: 'dangerous', secret: true };

export const RPC_RISKS: Readonly<Record<string, RpcMethodRisk>> = {
  // blockchain
  dumptxoutset: D,
  getbestblockhash: R,
  getblock: R,
  getblockchaininfo: R,
  getblockcount: R,
  getblockfilter: R,
  getblockfrompeer: S,
  getblockhash: R,
  getblockheader: R,
  getblockstats: H,
  getchainstates: R,
  getchaintips: R,
  getchaintxstats: R,
  getdeploymentinfo: R,
  getdescriptoractivity: H,
  getdifficulty: R,
  getmempoolancestors: R,
  getmempoolcluster: R,
  getmempooldescendants: R,
  getmempoolentry: R,
  getmempoolinfo: R,
  getrawmempool: R,
  gettxout: R,
  gettxoutproof: R,
  gettxoutsetinfo: H,
  gettxspendingprevout: R,
  importmempool: D,
  loadtxoutset: D,
  preciousblock: D,
  pruneblockchain: D,
  savemempool: S,
  scanblocks: H,
  scantxoutset: H,
  verifychain: H,
  verifytxoutproof: R,
  waitforblock: H,
  waitforblockheight: H,
  waitfornewblock: H,
  // control
  getmemoryinfo: R,
  getrpcinfo: R,
  help: R,
  logging: S,
  stop: D,
  uptime: R,
  // mining
  getblocktemplate: H,
  getmininginfo: R,
  getnetworkhashps: R,
  getprioritisedtransactions: R,
  prioritisetransaction: S,
  submitblock: D,
  submitheader: S,
  // network
  addnode: S,
  clearbanned: S,
  disconnectnode: S,
  getaddednodeinfo: R,
  getaddrmaninfo: R,
  getconnectioncount: R,
  getnettotals: R,
  getnetworkinfo: R,
  getnodeaddresses: R,
  getpeerinfo: R,
  listbanned: R,
  ping: S,
  setban: S,
  setnetworkactive: D,
  // rawtransactions
  abortprivatebroadcast: S,
  analyzepsbt: R,
  combinepsbt: R,
  combinerawtransaction: R,
  converttopsbt: R,
  createpsbt: R,
  createrawtransaction: R,
  decodepsbt: R,
  decoderawtransaction: R,
  decodescript: R,
  descriptorprocesspsbt: SK,
  finalizepsbt: R,
  fundrawtransaction: S,
  getprivatebroadcastinfo: R,
  getrawtransaction: R,
  joinpsbts: R,
  sendrawtransaction: D,
  signrawtransactionwithkey: SK,
  submitpackage: D,
  testmempoolaccept: R,
  utxoupdatepsbt: R,
  // signer
  enumeratesigners: S,
  // util
  createmultisig: R,
  deriveaddresses: R,
  estimatesmartfee: R,
  getdescriptorinfo: R,
  getindexinfo: R,
  signmessagewithprivkey: SK,
  validateaddress: R,
  verifymessage: R,
  // wallet
  abandontransaction: D,
  abortrescan: S,
  backupwallet: S,
  bumpfee: D,
  createwallet: SK,
  createwalletdescriptor: S,
  encryptwallet: DK,
  getaddressesbylabel: R,
  getaddressinfo: R,
  getbalance: R,
  getbalances: R,
  gethdkeys: RK,
  getnewaddress: S,
  getrawchangeaddress: S,
  getreceivedbyaddress: R,
  getreceivedbylabel: R,
  gettransaction: R,
  getwalletinfo: R,
  importdescriptors: DK,
  importprunedfunds: S,
  keypoolrefill: S,
  listaddressgroupings: R,
  listdescriptors: RK,
  listlabels: R,
  listlockunspent: R,
  listreceivedbyaddress: R,
  listreceivedbylabel: R,
  listsinceblock: R,
  listtransactions: R,
  listunspent: R,
  listwalletdir: R,
  listwallets: R,
  loadwallet: S,
  lockunspent: S,
  migratewallet: DK,
  psbtbumpfee: S,
  removeprunedfunds: D,
  rescanblockchain: H,
  restorewallet: S,
  send: D,
  sendall: D,
  sendmany: D,
  sendtoaddress: D,
  setlabel: S,
  setwalletflag: S,
  signmessage: S,
  signrawtransactionwithwallet: S,
  simulaterawtransaction: R,
  unloadwallet: S,
  walletcreatefundedpsbt: S,
  walletdisplayaddress: S,
  walletlock: S,
  walletpassphrase: SK,
  walletpassphrasechange: SK,
  walletprocesspsbt: S,
  // zmq
  getzmqnotifications: R,
  // hidden but useful
  estimaterawfee: R,
  getmempoolfeeratediagram: R,
  getorphantxs: R,
  getrawaddrman: R,
  generateblock: S,
  generatetoaddress: S,
  generatetodescriptor: S,
  invalidateblock: D,
  reconsiderblock: D,
  // Bitcoin Knots 29.4.2, with the legacy wallets of Bitcoin Core before 30
  addmultisigaddress: S,
  dumpmasterprivkey: DK,
  dumpprivkey: DK,
  dumpwallet: DK,
  getgeneralinfo: R,
  getmempoolstats: R,
  getrpcwhitelist: R,
  getunconfirmedbalance: R,
  importaddress: S,
  importmulti: SK,
  importprivkey: SK,
  importpubkey: S,
  importwallet: D,
  listmempooltransactions: R,
  listprunelocks: R,
  maxmempool: S,
  newkeypool: D,
  savefeeestimates: S,
  scriptthreadsinfo: R,
  setfeerate: S,
  sethdseed: DK,
  setprunelock: S,
  setscriptthreadsenabled: S,
  settxfee: S,
  sweepprivkeys: DK,
  upgradewallet: D,
};

/** What an unknown method (a newer version, Bitcoin Knots) is treated as until it is classified. */
export const UNKNOWN_METHOD_RISK: RpcMethodRisk = DK;

export function rpcMethodRisk(method: string): RpcMethodRisk {
  return RPC_RISKS[method] ?? UNKNOWN_METHOD_RISK;
}

/**
 * Methods BTCortex's console does not run, with the reason. Private keys and
 * wallet passphrases never pass through BTCortex's interface; test-only
 * methods have no place on a real node; stopping goes through BTCortex so
 * that it knows the node is shutting down.
 */
export const CONSOLE_BLOCKED: Readonly<Record<string, string>> = {
  stop: 'Use Stop in BTCortex, so that it knows the node is shutting down.',
  signrawtransactionwithkey:
    'It takes private keys, and BTCortex never handles private keys. Sign with Sparrow, a hardware wallet or Bitcoin Core’s own console.',
  signmessagewithprivkey:
    'It takes a private key, and BTCortex never handles private keys. Use Bitcoin Core’s own console.',
  descriptorprocesspsbt:
    'Its descriptors can contain private keys, which BTCortex never handles. Use Sparrow or Bitcoin Core’s own console.',
  importdescriptors:
    'Its descriptors can contain private keys, which BTCortex never handles. Use Sparrow or Bitcoin Core’s own console.',
  // Legacy wallets: Bitcoin Knots, and Bitcoin Core before 30.
  dumpprivkey: 'It shows a private key, which BTCortex never displays. Use the node’s own console.',
  dumpmasterprivkey:
    'It shows the wallet’s master private key, which BTCortex never displays. Use the node’s own console.',
  dumpwallet:
    'It writes every private key of the wallet to a file in plain text, which BTCortex does not do. Use the node’s own console.',
  importprivkey: 'It takes a private key, and BTCortex never handles private keys. Use the node’s own console.',
  importmulti: 'Its requests can contain private keys, which BTCortex never handles. Use the node’s own console.',
  sethdseed:
    'It can take a private key as the new seed, and BTCortex never handles private keys. Use the node’s own console.',
  sweepprivkeys: 'It takes private keys, and BTCortex never handles private keys. Use the node’s own console.',
  walletpassphrase: 'It takes a wallet passphrase, which BTCortex never handles. Use Bitcoin Core’s own console.',
  walletpassphrasechange: 'It takes wallet passphrases, which BTCortex never handles. Use Bitcoin Core’s own console.',
  encryptwallet: 'It takes a wallet passphrase, which BTCortex never handles. Use Bitcoin Core’s own console.',
  addconnection: 'A test-only method.',
  addpeeraddress: 'A test-only method.',
  echo: 'A test-only method.',
  echojson: 'A test-only method.',
  echoipc: 'A test-only method.',
  generate: 'A test-only method.',
  mockscheduler: 'A test-only method.',
  sendmsgtopeer: 'A test-only method.',
  setmocktime: 'A test-only method.',
  syncwithvalidationinterfacequeue: 'A test-only method.',
};

/** Parameters that would make a read method return private keys. */
export function requestsPrivateKeys(method: string, params: readonly unknown[] | Record<string, unknown>): boolean {
  if (method !== 'listdescriptors' && method !== 'gethdkeys') return false;
  if (Array.isArray(params)) {
    // listdescriptors (private); gethdkeys ({ "private": true, … }).
    const first: unknown = params[0];
    if (first === true || first === 'true') return true;
    return typeof first === 'object' && first !== null && (first as Record<string, unknown>)['private'] === true;
  }
  const named = params as Record<string, unknown>;
  const options = named['options'];
  return (
    named['private'] === true ||
    (typeof options === 'object' && options !== null && (options as Record<string, unknown>)['private'] === true)
  );
}

function passphraseGiven(params: readonly unknown[] | Record<string, unknown>, position: number): boolean {
  const value: unknown = Array.isArray(params) ? params[position] : (params as Record<string, unknown>)['passphrase'];
  return typeof value === 'string' && value !== '';
}

/** Why the console will not run this call, if it will not. */
export function consoleBlockReason(
  method: string,
  params: readonly unknown[] | Record<string, unknown>,
): string | undefined {
  const fixed = CONSOLE_BLOCKED[method];
  if (fixed !== undefined) return fixed;
  if (requestsPrivateKeys(method, params)) {
    return 'It would show private keys, which BTCortex never displays. Leave "private" off, or use Bitcoin Core’s own console.';
  }
  // createwallet "name" disable_private_keys blank "passphrase" …; migratewallet "name" "passphrase".
  if (
    (method === 'createwallet' && passphraseGiven(params, 3)) ||
    (method === 'migratewallet' && passphraseGiven(params, 1))
  ) {
    return 'With a passphrase it would pass a wallet secret through BTCortex, which never handles them. Leave the passphrase out, or use Bitcoin Core’s own console.';
  }
  return undefined;
}

/** Categories as `help` prints them, for example "== Blockchain ==". */
export function parseHelpCatalogue(text: string): { name: string; category: string }[] {
  const methods: { name: string; category: string }[] = [];
  let category = 'Other';
  for (const line of text.split(/\r?\n/)) {
    const heading = /^==\s*(.+?)\s*==$/.exec(line.trim());
    if (heading) {
      category = heading[1] ?? category;
      continue;
    }
    const name = /^([a-z][a-z0-9]*)\b/.exec(line.trim())?.[1];
    if (name) methods.push({ name, category });
  }
  return methods;
}
