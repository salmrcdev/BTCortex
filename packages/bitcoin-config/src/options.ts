// Catalogue of Bitcoin Core configuration options shown in the graphical
// editor. Defaults and version history are for Bitcoin Core 31.1, from
// share/examples/bitcoin.conf and the AddArg registrations
// (docs/research/notes/full-nodes-core.md §6). Every change needs a node
// restart: bitcoind reads bitcoin.conf only at start-up.

export type OptionType = 'boolean' | 'integer' | 'string' | 'list' | 'feerate' | 'amount' | 'path' | 'enum';

export type OptionCategory =
  | 'chain'
  | 'storage'
  | 'indexes'
  | 'performance'
  | 'connections'
  | 'privacy'
  | 'bandwidth'
  | 'relay'
  | 'rpc'
  | 'wallet'
  | 'zmq'
  | 'logging'
  | 'notifications';

/**
 * - `exposure`: widens what the node exposes to the network or other programs.
 * - `executes-commands`: runs a shell command on events.
 * - `destructive`: rebuilds or deletes data when the node starts.
 * The editor asks for explicit confirmation before changing any of these.
 */
export type OptionRisk = 'normal' | 'exposure' | 'executes-commands' | 'destructive';

export interface OptionDefinition {
  readonly key: string;
  readonly category: OptionCategory;
  readonly type: OptionType;
  /** Upstream default as written in bitcoin.conf; `undefined` when unset or network-dependent. */
  readonly defaultValue?: string;
  readonly description: string;
  /** Applies to mainnet only unless placed in a network section (`NETWORK_ONLY`). */
  readonly networkOnly?: boolean;
  readonly sensitive?: boolean;
  readonly risk?: OptionRisk;
  readonly values?: readonly string[];
  readonly minimum?: number;
  readonly maximum?: number;
  /** Unit of a numeric value, shown next to it (fee rates are always BTC/kvB, amounts BTC). */
  readonly unit?: string;
  readonly addedIn?: string;
  readonly deprecatedIn?: string;
  readonly removedIn?: string;
  readonly replacement?: string;
  /** Valid on the command line only; an error inside bitcoin.conf. */
  readonly commandLineOnly?: boolean;
  /** One-shot actions that must never stay in bitcoin.conf. */
  readonly oneShot?: boolean;
}

const definitions: OptionDefinition[] = [
  // Chain selection
  {
    key: 'chain',
    category: 'chain',
    type: 'enum',
    values: ['main', 'test', 'testnet4', 'signet', 'regtest'],
    description: 'Selects the chain. Prefer the dedicated selectors below.',
  },
  {
    key: 'testnet',
    category: 'chain',
    type: 'boolean',
    defaultValue: '0',
    deprecatedIn: '28.0',
    replacement: 'testnet4',
    description: 'Uses testnet3, which is deprecated in favour of testnet4.',
  },
  {
    key: 'testnet4',
    category: 'chain',
    type: 'boolean',
    defaultValue: '0',
    addedIn: '28.0',
    description: 'Uses testnet4 (BIP94).',
  },
  {
    key: 'signet',
    category: 'chain',
    type: 'boolean',
    defaultValue: '0',
    description: 'Uses signet (BIP325), or a custom signet with signetchallenge.',
  },
  {
    key: 'signetchallenge',
    category: 'chain',
    type: 'string',
    description: 'Block challenge of a custom signet. Every custom signet needs its own data directory.',
  },
  { key: 'signetseednode', category: 'chain', type: 'list', description: 'Seed node for a custom signet (host:port).' },
  {
    key: 'regtest',
    category: 'chain',
    type: 'boolean',
    defaultValue: '0',
    description: 'Uses regtest, a private test chain where blocks are created on demand.',
  },

  // Storage and lifecycle
  {
    key: 'datadir',
    category: 'storage',
    type: 'path',
    description: 'Data directory. Managed nodes receive it on the command line instead.',
  },
  {
    key: 'blocksdir',
    category: 'storage',
    type: 'path',
    description: 'Stores block and undo files in another directory.',
  },
  {
    key: 'conf',
    category: 'storage',
    type: 'path',
    commandLineOnly: true,
    description: 'Configuration file path; valid on the command line only. Use includeconf inside a file.',
  },
  {
    key: 'includeconf',
    category: 'storage',
    type: 'list',
    description: 'Includes another configuration file, relative to the data directory. Not recursive.',
  },
  {
    key: 'settings',
    category: 'storage',
    type: 'path',
    description: 'Path of settings.json, which overrides bitcoin.conf.',
  },
  {
    key: 'prune',
    category: 'storage',
    type: 'integer',
    unit: 'MiB',
    defaultValue: '0',
    minimum: 0,
    // Pruning deletes block files, and leaving it needs a full re-download.
    risk: 'destructive',
    description:
      'Keeps only recent blocks: 0 disables pruning, 1 allows manual pruning, 550 or more is the target size in MiB. Incompatible with txindex; returning to a full node needs a complete re-download.',
  },
  {
    key: 'blocksxor',
    category: 'storage',
    type: 'boolean',
    defaultValue: '1',
    addedIn: '28.0',
    description: 'Obfuscates new block files with a random key. Releases before 28.0 cannot read such directories.',
  },
  {
    key: 'persistmempool',
    category: 'storage',
    type: 'boolean',
    defaultValue: '1',
    description: 'Saves the mempool on shutdown and reloads it on start-up.',
  },
  {
    key: 'persistmempoolv1',
    category: 'storage',
    type: 'boolean',
    defaultValue: '0',
    description: 'Writes the pre-27.0 mempool.dat format, for downgrades.',
  },
  {
    key: 'loadblock',
    category: 'storage',
    type: 'list',
    description: 'Imports blocks from external blk files on start-up.',
  },
  {
    key: 'reindex',
    category: 'storage',
    type: 'boolean',
    defaultValue: '0',
    oneShot: true,
    risk: 'destructive',
    description:
      'Rebuilds the block index and chainstate from the block files. On a pruned node this re-downloads the whole blockchain.',
  },
  {
    key: 'reindex-chainstate',
    category: 'storage',
    type: 'boolean',
    defaultValue: '0',
    oneShot: true,
    risk: 'destructive',
    description: 'Rebuilds the chainstate from local block files. Not possible on pruned nodes.',
  },
  {
    key: 'pid',
    category: 'storage',
    type: 'path',
    defaultValue: 'bitcoind.pid',
    description: 'Process identifier file.',
  },
  {
    key: 'allowignoredconf',
    category: 'storage',
    type: 'boolean',
    defaultValue: '0',
    description: 'Turns the "ignored bitcoin.conf" start-up error into a warning.',
  },
  {
    key: 'daemon',
    category: 'storage',
    type: 'boolean',
    defaultValue: '0',
    description: 'Runs in the background. Not supported on Windows: bitcoind refuses to start.',
  },

  // Indexes
  {
    key: 'txindex',
    category: 'indexes',
    type: 'boolean',
    defaultValue: '0',
    description:
      'Indexes every transaction, so getrawtransaction works for confirmed transactions. Needs an unpruned node.',
  },
  {
    key: 'txospenderindex',
    category: 'indexes',
    type: 'boolean',
    defaultValue: '0',
    addedIn: '31.0',
    description: 'Indexes which transaction spent each output (gettxspendingprevout). Needs an unpruned node.',
  },
  {
    key: 'blockfilterindex',
    category: 'indexes',
    type: 'string',
    defaultValue: '0',
    description: 'Builds BIP158 compact block filters ("1" or "basic"). Compatible with pruning.',
  },
  {
    key: 'coinstatsindex',
    category: 'indexes',
    type: 'boolean',
    defaultValue: '0',
    description: 'Speeds up gettxoutsetinfo. Compatible with pruning.',
  },

  // Performance
  {
    key: 'dbcache',
    category: 'performance',
    type: 'integer',
    unit: 'MiB',
    minimum: 4,
    description:
      'Database cache in MiB. Default 1024 with 4 GiB of memory or more, otherwise 450. Larger values speed up the initial synchronisation.',
  },
  {
    key: 'par',
    category: 'performance',
    type: 'integer',
    unit: 'threads',
    defaultValue: '0',
    description: 'Script verification threads (0 = automatic; negative leaves that many cores free).',
  },
  {
    key: 'assumevalid',
    category: 'performance',
    type: 'string',
    description: 'Skips script checks for ancestors of this block hash. 0 verifies every script.',
  },
  {
    key: 'blockreconstructionextratxn',
    category: 'performance',
    type: 'integer',
    defaultValue: '100',
    description: 'Extra transactions kept for compact block reconstruction.',
  },

  // Connections
  {
    key: 'listen',
    category: 'connections',
    type: 'boolean',
    defaultValue: '1',
    risk: 'exposure',
    description:
      'Accepts incoming connections. On by default unless a proxy, connect or maxconnections=0 is set. BTCortex turns it off so that Windows asks no firewall question and the node’s address is not advertised.',
  },
  {
    key: 'bind',
    category: 'connections',
    type: 'list',
    networkOnly: true,
    risk: 'exposure',
    description: 'Local address to listen on. Any explicit bind replaces the default onion bind.',
  },
  {
    key: 'whitebind',
    category: 'connections',
    type: 'list',
    risk: 'exposure',
    description: 'Listening address whose peers receive permissions.',
  },
  {
    key: 'port',
    category: 'connections',
    type: 'integer',
    networkOnly: true,
    minimum: 1,
    maximum: 65535,
    description: 'Peer-to-peer port.',
  },
  {
    key: 'maxconnections',
    category: 'connections',
    type: 'integer',
    unit: 'connections',
    defaultValue: '125',
    minimum: 0,
    description: 'Maximum automatic connections. The default rises to 200 in 32.0.',
  },
  {
    key: 'addnode',
    category: 'connections',
    type: 'list',
    networkOnly: true,
    description: 'Adds a peer to connect to and keeps the connection open.',
  },
  {
    key: 'connect',
    category: 'connections',
    type: 'list',
    networkOnly: true,
    description: 'Connects only to these peers; disables automatic connections and DNS seeding.',
  },
  {
    key: 'seednode',
    category: 'connections',
    type: 'list',
    description: 'Connects to a peer to retrieve addresses, then disconnects.',
  },
  {
    key: 'dns',
    category: 'connections',
    type: 'boolean',
    defaultValue: '1',
    description: 'Allows DNS lookups for addnode, seednode and connect.',
  },
  {
    key: 'dnsseed',
    category: 'connections',
    type: 'boolean',
    defaultValue: '1',
    description: 'Queries DNS seeds for peer addresses when few are known.',
  },
  {
    key: 'forcednsseed',
    category: 'connections',
    type: 'boolean',
    defaultValue: '0',
    description: 'Always queries DNS seeds.',
  },
  {
    key: 'fixedseeds',
    category: 'connections',
    type: 'boolean',
    defaultValue: '1',
    description: 'Uses the built-in seed addresses if DNS seeds fail.',
  },
  {
    key: 'discover',
    category: 'connections',
    type: 'boolean',
    defaultValue: '1',
    description: 'Discovers own addresses when listening without a proxy.',
  },
  {
    key: 'externalip',
    category: 'connections',
    type: 'list',
    risk: 'exposure',
    description: 'Advertises this address to peers.',
  },
  {
    key: 'natpmp',
    category: 'connections',
    type: 'boolean',
    defaultValue: '1',
    risk: 'exposure',
    description: 'Maps the listening port on the router with PCP or NAT-PMP (on by default since 30.0).',
  },
  {
    key: 'upnp',
    category: 'connections',
    type: 'boolean',
    removedIn: '30.0',
    replacement: 'natpmp',
    description: 'UPnP port mapping, removed in 30.0.',
  },
  {
    key: 'timeout',
    category: 'connections',
    type: 'integer',
    unit: 'ms',
    defaultValue: '5000',
    minimum: 1,
    description: 'Connection timeout in milliseconds.',
  },
  {
    key: 'bantime',
    category: 'connections',
    type: 'integer',
    unit: 'seconds',
    defaultValue: '86400',
    minimum: 0,
    description: 'Default duration of a manual ban, in seconds.',
  },
  {
    key: 'whitelist',
    category: 'connections',
    type: 'list',
    risk: 'exposure',
    description: 'Grants permissions to peers from these addresses.',
  },
  {
    key: 'networkactive',
    category: 'connections',
    type: 'boolean',
    defaultValue: '1',
    description: 'Enables peer-to-peer networking at start-up.',
  },
  {
    key: 'v2transport',
    category: 'connections',
    type: 'boolean',
    defaultValue: '1',
    description: 'Uses BIP324 encrypted peer-to-peer transport where supported.',
  },
  {
    key: 'peerbloomfilters',
    category: 'connections',
    type: 'boolean',
    defaultValue: '0',
    risk: 'exposure',
    description: 'Serves BIP37 bloom filters to peers.',
  },
  {
    key: 'peerblockfilters',
    category: 'connections',
    type: 'boolean',
    defaultValue: '0',
    description: 'Serves BIP157 compact block filters to peers. Needs blockfilterindex.',
  },
  {
    key: 'asmap',
    category: 'connections',
    type: 'string',
    description: 'Diversifies peers by autonomous system; asmap=1 uses the embedded map (31.0+).',
  },
  {
    key: 'onlynet',
    category: 'connections',
    type: 'list',
    values: ['ipv4', 'ipv6', 'onion', 'i2p', 'cjdns'],
    description: 'Makes automatic outbound connections only on these networks.',
  },

  // Privacy networks
  {
    key: 'proxy',
    category: 'privacy',
    type: 'string',
    description: 'SOCKS5 proxy for outgoing connections, for example 127.0.0.1:9050 for Tor.',
  },
  { key: 'onion', category: 'privacy', type: 'string', description: 'Separate SOCKS5 proxy for onion peers.' },
  {
    key: 'listenonion',
    category: 'privacy',
    type: 'boolean',
    defaultValue: '1',
    description: 'Creates an onion service automatically when Tor control is reachable.',
  },
  {
    key: 'torcontrol',
    category: 'privacy',
    type: 'string',
    defaultValue: '127.0.0.1:9051',
    description: 'Tor control port used for the automatic onion service.',
  },
  {
    key: 'torpassword',
    category: 'privacy',
    type: 'string',
    sensitive: true,
    description: 'Tor control port password.',
  },
  {
    key: 'proxyrandomize',
    category: 'privacy',
    type: 'boolean',
    defaultValue: '1',
    description: 'Uses random credentials per proxy connection, isolating Tor circuits.',
  },
  { key: 'i2psam', category: 'privacy', type: 'string', description: 'I2P SAM bridge address.' },
  {
    key: 'i2pacceptincoming',
    category: 'privacy',
    type: 'boolean',
    defaultValue: '1',
    description: 'Accepts incoming I2P connections.',
  },
  {
    key: 'cjdnsreachable',
    category: 'privacy',
    type: 'boolean',
    defaultValue: '0',
    description: 'Declares that CJDNS addresses are reachable.',
  },
  {
    key: 'privatebroadcast',
    category: 'privacy',
    type: 'boolean',
    defaultValue: '0',
    addedIn: '31.0',
    description:
      'Broadcasts sendrawtransaction transactions over short-lived Tor or I2P connections. Use 31.1 or later.',
  },

  // Bandwidth
  {
    key: 'maxuploadtarget',
    category: 'bandwidth',
    type: 'string',
    defaultValue: '0',
    description: 'Upload limit per 24 hours (for example 5000 for 5000 MiB, or 5G); 0 disables the limit.',
  },
  {
    key: 'maxreceivebuffer',
    category: 'bandwidth',
    type: 'integer',
    unit: 'kB',
    defaultValue: '5000',
    minimum: 1,
    description: 'Receive buffer per connection, in thousands of bytes.',
  },
  {
    key: 'maxsendbuffer',
    category: 'bandwidth',
    type: 'integer',
    unit: 'kB',
    defaultValue: '1000',
    minimum: 1,
    description: 'Send buffer per connection, in thousands of bytes.',
  },
  {
    key: 'blocksonly',
    category: 'bandwidth',
    type: 'boolean',
    defaultValue: '0',
    description:
      'Stops transaction relay. Fee estimation then has no data, and own transactions become easy to attribute.',
  },

  // Relay and mempool policy
  {
    key: 'maxmempool',
    category: 'relay',
    type: 'integer',
    unit: 'MB',
    defaultValue: '300',
    minimum: 5,
    description: 'Mempool memory limit in MB.',
  },
  {
    key: 'mempoolexpiry',
    category: 'relay',
    type: 'integer',
    unit: 'hours',
    defaultValue: '336',
    minimum: 1,
    description: 'Hours an unconfirmed transaction stays in the mempool.',
  },
  {
    key: 'minrelaytxfee',
    category: 'relay',
    type: 'feerate',
    defaultValue: '0.000001',
    description: 'Minimum fee rate for relay, in BTC/kvB (0.000001 = 0.1 sat/vB since 30.0).',
  },
  {
    key: 'blockmintxfee',
    category: 'relay',
    type: 'feerate',
    defaultValue: '0.00000001',
    description: 'Minimum fee rate for transactions in block templates, in BTC/kvB.',
  },
  {
    key: 'datacarrier',
    category: 'relay',
    type: 'boolean',
    defaultValue: '1',
    description: 'Relays and mines transactions with OP_RETURN outputs.',
  },
  {
    key: 'datacarriersize',
    category: 'relay',
    type: 'integer',
    defaultValue: '100000',
    minimum: 0,
    description:
      'Maximum total OP_RETURN data in relayed transactions (100000 since 30.0; 83 restores the previous limit).',
  },
  {
    key: 'permitbaremultisig',
    category: 'relay',
    type: 'boolean',
    defaultValue: '1',
    description: 'Relays bare multisig outputs.',
  },
  {
    key: 'bytespersigop',
    category: 'relay',
    type: 'integer',
    defaultValue: '20',
    minimum: 1,
    description: 'Equivalent bytes per signature operation for relay policy.',
  },
  {
    key: 'whitelistrelay',
    category: 'relay',
    type: 'boolean',
    defaultValue: '1',
    description: 'Relays transactions from whitelisted peers even without relay permission.',
  },
  {
    key: 'whitelistforcerelay',
    category: 'relay',
    type: 'boolean',
    defaultValue: '0',
    description: 'Relays transactions from whitelisted peers even if they violate policy.',
  },
  {
    key: 'blockreservedweight',
    category: 'relay',
    type: 'integer',
    defaultValue: '8000',
    minimum: 2000,
    maximum: 4000000,
    addedIn: '29.0',
    description: 'Block weight reserved for the coinbase in mining templates.',
  },
  {
    key: 'mempoolfullrbf',
    category: 'relay',
    type: 'boolean',
    removedIn: '29.0',
    description: 'Full replace-by-fee option, removed in 29.0: full RBF is always on.',
  },
  {
    key: 'limitancestorcount',
    category: 'relay',
    type: 'integer',
    deprecatedIn: '31.0',
    description: 'Ancestor limit; replaced by cluster limits in 31.0 and only used by wallet coin selection.',
  },
  {
    key: 'limitdescendantcount',
    category: 'relay',
    type: 'integer',
    deprecatedIn: '31.0',
    description: 'Descendant limit; replaced by cluster limits in 31.0.',
  },
  {
    key: 'limitancestorsize',
    category: 'relay',
    type: 'integer',
    deprecatedIn: '31.0',
    description: 'Ignored since 31.0 (cluster mempool).',
  },
  {
    key: 'limitdescendantsize',
    category: 'relay',
    type: 'integer',
    deprecatedIn: '31.0',
    description: 'Ignored since 31.0 (cluster mempool).',
  },
  {
    key: 'maxorphantx',
    category: 'relay',
    type: 'integer',
    removedIn: '31.0',
    description: 'Orphan transaction limit, removed in 31.0.',
  },

  // RPC and REST
  {
    key: 'server',
    category: 'rpc',
    type: 'boolean',
    description: 'Accepts JSON-RPC commands. On by default for bitcoind, off for bitcoin-qt.',
  },
  {
    key: 'rpcbind',
    category: 'rpc',
    type: 'list',
    networkOnly: true,
    risk: 'exposure',
    description: 'Address the RPC server listens on. Ignored unless rpcallowip is also set.',
  },
  {
    key: 'rpcallowip',
    category: 'rpc',
    type: 'list',
    risk: 'exposure',
    description: 'Allows RPC connections from these addresses or subnets.',
  },
  {
    key: 'rpcport',
    category: 'rpc',
    type: 'integer',
    networkOnly: true,
    minimum: 1,
    maximum: 65535,
    description: 'RPC port.',
  },
  {
    key: 'rpcauth',
    category: 'rpc',
    type: 'list',
    sensitive: true,
    description: 'RPC user with a salted password hash (user:salt$hash).',
  },
  {
    key: 'rpcuser',
    category: 'rpc',
    type: 'string',
    sensitive: true,
    description: 'RPC user name. rpcauth is preferred.',
  },
  {
    key: 'rpcpassword',
    category: 'rpc',
    type: 'string',
    sensitive: true,
    description: 'RPC password in plain text. Disables the cookie; rpcauth is preferred.',
  },
  { key: 'rpccookiefile', category: 'rpc', type: 'path', description: 'Location of the RPC cookie file.' },
  {
    key: 'rpccookieperms',
    category: 'rpc',
    type: 'enum',
    values: ['owner', 'group', 'all'],
    description: 'Cookie file permissions. On Windows the folder permissions apply instead.',
  },
  {
    key: 'rpcwhitelist',
    category: 'rpc',
    type: 'list',
    description: 'Restricts an RPC user to listed methods (user:method,method).',
  },
  {
    key: 'rpcwhitelistdefault',
    category: 'rpc',
    type: 'boolean',
    description: 'When any whitelist exists, users without one are denied everything unless this is 0.',
  },
  {
    key: 'rpcthreads',
    category: 'rpc',
    type: 'integer',
    unit: 'threads',
    defaultValue: '16',
    minimum: 1,
    description: 'Threads serving RPC calls.',
  },
  {
    key: 'rest',
    category: 'rpc',
    type: 'boolean',
    defaultValue: '0',
    risk: 'exposure',
    description: 'Enables the unauthenticated REST interface on the RPC port.',
  },

  // Wallet
  {
    key: 'disablewallet',
    category: 'wallet',
    type: 'boolean',
    defaultValue: '0',
    description:
      'Disables the node wallet and its RPCs. Sparrow connected directly to Bitcoin Core needs the wallet enabled.',
  },
  { key: 'wallet', category: 'wallet', type: 'list', networkOnly: true, description: 'Loads this wallet at start-up.' },
  { key: 'walletdir', category: 'wallet', type: 'path', networkOnly: true, description: 'Directory holding wallets.' },
  {
    key: 'addresstype',
    category: 'wallet',
    type: 'enum',
    defaultValue: 'bech32',
    values: ['legacy', 'p2sh-segwit', 'bech32', 'bech32m'],
    description: 'Address type for new receiving addresses.',
  },
  {
    key: 'changetype',
    category: 'wallet',
    type: 'enum',
    values: ['legacy', 'p2sh-segwit', 'bech32', 'bech32m'],
    description: 'Address type for change outputs.',
  },
  {
    key: 'avoidpartialspends',
    category: 'wallet',
    type: 'boolean',
    defaultValue: '0',
    description: 'Spends all outputs of an address together, improving privacy.',
  },
  {
    key: 'fallbackfee',
    category: 'wallet',
    type: 'feerate',
    defaultValue: '0',
    description: 'Fee rate used when estimation has no data; 0 refuses to send instead.',
  },
  {
    key: 'keypool',
    category: 'wallet',
    type: 'integer',
    defaultValue: '1000',
    minimum: 0,
    description: 'Pre-generated keys per descriptor.',
  },
  {
    key: 'maxtxfee',
    category: 'wallet',
    type: 'amount',
    defaultValue: '0.10',
    description: 'Maximum total fee of a single wallet transaction, in BTC.',
  },
  {
    key: 'mintxfee',
    category: 'wallet',
    type: 'feerate',
    defaultValue: '0.00001',
    description: 'Lowest fee rate the wallet uses, in BTC/kvB.',
  },
  {
    key: 'spendzeroconfchange',
    category: 'wallet',
    type: 'boolean',
    defaultValue: '1',
    description: 'Allows spending unconfirmed change.',
  },
  {
    key: 'txconfirmtarget',
    category: 'wallet',
    type: 'integer',
    unit: 'blocks',
    defaultValue: '6',
    minimum: 1,
    description: 'Confirmation target in blocks for fee estimation.',
  },
  {
    key: 'walletbroadcast',
    category: 'wallet',
    type: 'boolean',
    defaultValue: '1',
    description: 'Broadcasts wallet transactions.',
  },
  {
    key: 'walletrbf',
    category: 'wallet',
    type: 'boolean',
    defaultValue: '1',
    description: 'Signals replace-by-fee in wallet transactions (deprecated in 32.0).',
  },
  {
    key: 'walletnotify',
    category: 'wallet',
    type: 'string',
    risk: 'executes-commands',
    description: 'Runs a command when a wallet transaction changes.',
  },
  {
    key: 'signer',
    category: 'wallet',
    type: 'string',
    risk: 'executes-commands',
    description: 'External signing tool, for example HWI.',
  },
  {
    key: 'paytxfee',
    category: 'wallet',
    type: 'feerate',
    removedIn: '31.0',
    description: 'Fixed wallet fee rate, removed in 31.0.',
  },

  // ZMQ
  {
    key: 'zmqpubhashblock',
    category: 'zmq',
    type: 'string',
    risk: 'exposure',
    description: 'Publishes new block hashes (for example tcp://127.0.0.1:28332).',
  },
  {
    key: 'zmqpubhashtx',
    category: 'zmq',
    type: 'string',
    risk: 'exposure',
    description: 'Publishes transaction hashes.',
  },
  { key: 'zmqpubrawblock', category: 'zmq', type: 'string', risk: 'exposure', description: 'Publishes raw blocks.' },
  { key: 'zmqpubrawtx', category: 'zmq', type: 'string', risk: 'exposure', description: 'Publishes raw transactions.' },
  {
    key: 'zmqpubsequence',
    category: 'zmq',
    type: 'string',
    risk: 'exposure',
    description: 'Publishes block connections and mempool changes with sequence numbers.',
  },

  // Logging
  {
    key: 'debug',
    category: 'logging',
    type: 'list',
    description: 'Logs debugging information for a category, or for all with 1.',
  },
  { key: 'debugexclude', category: 'logging', type: 'list', description: 'Excludes a debugging category.' },
  {
    key: 'logips',
    category: 'logging',
    type: 'boolean',
    defaultValue: '0',
    description: 'Includes IP addresses in the log. Privacy-sensitive.',
  },
  {
    key: 'logtimestamps',
    category: 'logging',
    type: 'boolean',
    defaultValue: '1',
    description: 'Prefixes log lines with timestamps.',
  },
  {
    key: 'logthreadnames',
    category: 'logging',
    type: 'boolean',
    defaultValue: '0',
    description: 'Prefixes log lines with the thread name.',
  },
  {
    key: 'printtoconsole',
    category: 'logging',
    type: 'boolean',
    description: 'Writes the log to standard output. BTCortex disables it for managed nodes.',
  },
  {
    key: 'shrinkdebugfile',
    category: 'logging',
    type: 'boolean',
    description: 'Truncates debug.log above 11 MB at start-up.',
  },
  {
    key: 'uacomment',
    category: 'logging',
    type: 'list',
    description: 'Comment appended to the user agent advertised to peers.',
  },

  // Notifications that run commands
  {
    key: 'alertnotify',
    category: 'notifications',
    type: 'string',
    risk: 'executes-commands',
    description: 'Runs a command on alerts or long forks.',
  },
  {
    key: 'blocknotify',
    category: 'notifications',
    type: 'string',
    risk: 'executes-commands',
    description: 'Runs a command when the best block changes.',
  },
  {
    key: 'startupnotify',
    category: 'notifications',
    type: 'string',
    risk: 'executes-commands',
    description: 'Runs a command after start-up.',
  },
  {
    key: 'shutdownnotify',
    category: 'notifications',
    type: 'string',
    risk: 'executes-commands',
    description: 'Runs a command just before shutdown.',
  },
];

export const OPTION_DEFINITIONS: ReadonlyMap<string, OptionDefinition> = new Map(
  definitions.map((definition) => [definition.key, definition]),
);

/** Resolves `nofoo` to the definition of `foo` for negation handling. */
export function lookupOption(key: string): { definition: OptionDefinition; negated: boolean } | undefined {
  const direct = OPTION_DEFINITIONS.get(key);
  if (direct) return { definition: direct, negated: false };
  if (key.startsWith('no')) {
    const base = OPTION_DEFINITIONS.get(key.slice(2));
    if (base) return { definition: base, negated: true };
  }
  return undefined;
}

/** Bitcoin Core reads booleans with atoi semantics: "true" means 0. */
export function interpretBoolean(value: string): boolean {
  if (value === '') return true;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed !== 0;
}
