# Electrum servers, indexers, block explorers and data services: technical reference (scope `electrum-indexers-explorers`)

Verified on **2026-10-21**. Records: [`../data/electrum-indexers-explorers.json`](../data/electrum-indexers-explorers.json) (21 entries) and [`../data/standards-electrum-indexers-explorers.json`](../data/standards-electrum-indexers-explorers.json) (6 specifications).

Every statement below was checked against a primary source fetched on the verification date: GitHub releases (REST API and release feeds), README files, documentation folders and source code at `master` (or the project's default branch), Docker Hub metadata, PyPI and npm registry metadata, and official websites. Where something could not be verified it says so; such claims are also listed in the `unverifiedClaims` of each record.

Projects owned by other scopes are referred to by canonical id only: `bitcoin-core`, `bitcoin-knots`, `sparrow`, `electrum`, `specter-desktop`, `trezor-suite`, `tor`, `nginx`, `caddy`, `frigate`, `floresta`, `btcpay-server`, `lnd`, `core-lightning`, `elements`. Generic databases (`postgresql`, `mariadb`, `mongodb`) appear as dependency ids without records; see the open questions at the end.

---

## 0. Key facts at a glance

| Entry | Latest stable (date) | Native Windows | Node requirements | Pruned node | Recommended level | Priority |
|---|---|---|---|---|---|---|
| `fulcrum` | 2.1.4 (2026-10-18) | **Yes**: x64 portable ZIP | txindex=1, RPC, ZMQ hashblock recommended | **No** | `fully-managed` | P1 |
| `electrs` | 0.12.0 (2026-09-13) | Partial (source only; no Windows CI) | **Core ≥ 31**, rest=1, RPC | **No** | `connected-application` (WSL2 as opt-in) | P1 |
| `electrumx` | 2.0.0 (2026-07-03) | No | **Core ≥ 31**, txindex=1 **and** txospenderindex=1 | **No** | `connected-application` | P2 |
| `electrum-personal-server` | 0.2.4 (2022-06-16), stale | Yes (2022 ZIP) | Legacy wallet + `importmulti` | Yes, historically | **`unsupported`** (incompatible with Core ≥ 30) | P3 |
| `bwt` | 0.2.4 (2021-03-24), stale | Yes (2021 ZIP) | `importmulti` | Yes, historically | **`unsupported`** (incompatible with Core ≥ 30) | P3 |
| `electrum-server-legacy` | none, discontinued | — | — | — | `unsupported` | P3 |
| `mempool` | 3.3.1 (2026-04-21) | No | txindex=1 + MariaDB, optional Electrum back end | **No** | `managed-docker` | P1 |
| `btc-rpc-explorer` | 3.5.1 (2025-07-02, GitHub only; npm has 3.4.0) | Partial (Node.js) | RPC; txindex optional | **Yes, reduced functionality** | `fully-managed` | P1 |
| `nbxplorer` | 2.6.19 (2026-09-30) | Partial (.NET 10 source) | Core ≥ 24, RPC **and P2P**, PostgreSQL ≥ 13 | **Yes** | `managed-docker` | P2 |
| `esplora` | 3.0.1 (2026-08-25) | No | Bundles its own node | No | `connected-application` | P3 |
| `blockstream-electrs` | no releases (commits 2026-10-19) | Unknown | Block files or `--jsonrpc-import` | No | `connected-application` | P3 |
| `mempool-electrs` | 3.3.0 (2026-01-01) | Unknown | Block files | No | `managed-docker` | P3 |
| `blockbook` | 0.6.0 (2026-07-16) | No (Debian AMD64 only) | txindex=1, ZMQ | No | `connected-application` | P3 |
| `mempool-space-api` | hosted | n/a | — | n/a | `connected-application` (opt-in, labelled external) | P2 |
| `blockstream-info-api` | hosted | n/a | — | n/a | `connected-application` (opt-in, labelled external) | P3 |
| `bitfeed`, `bitcore-node`, `ord`, `bitcoin-research-kit`, `waterfalls`, `btc-rpc-proxy` | see §11 | mixed | mixed | mostly no | `research-only` | P3 |

**Contradictions with the specification's assumptions**

1. **Windows support differs sharply** (spec section 7 lists Fulcrum, electrs and ElectrumX together). Only Fulcrum publishes native Windows binaries. electrs has no binaries at all and its CI builds only on Linux. ElectrumX states that it "won't run out-of-the-box on Windows". Every explorer except BTC RPC Explorer is Linux- or container-only. WSL2 or Docker is unavoidable for electrs, ElectrumX, mempool, Esplora and Blockbook.
2. **No Electrum server works with a pruned node.** Fulcrum, electrs, ElectrumX, the Esplora back ends and Blockbook all need the full block history. The pruned-capable personal servers (Electrum Personal Server, bwt) are **incompatible with Bitcoin Core 30.0 and later**. They depend on legacy wallets and `importmulti`, both removed in 30.0 ([release notes](https://bitcoincore.org/en/releases/30.0/)). On the 73 GB test machine, Profile B (Core, Electrum server and Sparrow) cannot include a local Electrum server. Sparrow must connect to Bitcoin Core directly (see `sparrow`).
3. **Profile D (Full Bitcoin Explorer) needs about 1 TB.** mempool requires `txindex=1` even without an Electrum server. Esplora, Blockbook and Bitfeed need unpruned chains as well. The only explorer that runs against a pruned node is BTC RPC Explorer, with reduced functionality (§9).
4. **"Do not assume identical requirements" is an understatement in 2026.** electrs 0.12.0 needs Bitcoin Core ≥ 31 with the unauthenticated REST interface (`-rest=1`). ElectrumX 2.0.0 needs Core ≥ 31 with `txindex` **and** the new `txospenderindex` (66 GiB + 88 GiB at height ~950 000). Fulcrum needs `txindex` and works from Core 0.17. A Bitcoin Core 30.x node supports Fulcrum but **not** current electrs or ElectrumX.
5. **Bitcoin Knots claims are stale.** Fulcrum's README says Knots "is also known to work perfectly well", and ElectrumX 1.19 accepted "Core 28.0 (or Knots 28)". Both predate the Knots 29.4.1 hard fork. Knots 29.x is based on Core 29 and lacks Core 31's REST endpoints and `txospenderindex`. Electrum clients verify SHA256d proof of work ([`blockchain.py`](https://github.com/spesmilo/electrum/blob/master/electrum/blockchain.py): "insufficient proof of work"), so an Electrum server fed by a post-fork Knots node would serve headers those clients reject (inference, not tested).
6. **The Electrum protocol moved on.** Version 1.7 was merged on 2026-07-01 and is implemented only by ElectrumX 2.0. Electrum 4.8.2 negotiates 1.4–1.6, Sparrow offers 1.3–1.4.2, and electrs implements only 1.4. BTCortex's own health checks and client must negotiate, not assume.
7. **The recommended zero-touch node profile (`listen=0`, see `full-nodes-core` notes §6.9) breaks NBXplorer.** NBXplorer uses the node's P2P port for block and transaction announcements. electrs 0.9–0.11 used it too; 0.12 uses REST instead. When NBXplorer is installed the node needs `listen=1` with `bind=127.0.0.1`.
8. **Public data services are less open than assumed.** mempool.space enforces unpublished rate limits (HTTP 429, possible bans) and reset every connection from the research machine's VPN on 2026-10-21. Blockstream introduced free-tier rate limits and paid API tiers on 2026-04-22. Neither can be a silent default.

---

## 1. Landscape

### 1.1 Categories

- **Full-index Electrum servers** index every script hash so any wallet can be restored instantly: `fulcrum` (C++/Qt), `electrs` (Rust), `electrumx` (Python).
- **Explorer back ends with HTTP APIs**: `blockstream-electrs` and `mempool-electrs` (Esplora REST API plus Electrum), `blockbook` (Trezor), `bitcore-node` (BitPay Bitcore/Insight).
- **Wallet-scoped trackers** index only registered wallets and therefore work on pruned nodes: `nbxplorer` (maintained; BTCPay Server's back end); `electrum-personal-server` and `bwt` (stale, incompatible with Core ≥ 30). Sparrow's built-in Bitcoin Core connection (Cormorant, recorded under `sparrow`) and the Electrum server inside `floresta` (alternatives scope) fill the same niche today.
- **Explorers**: `mempool`, `esplora`, `btc-rpc-explorer`, Blockbook's built-in UI, Insight, `ord` (inscriptions), `bitcoin-research-kit` (analytics), `bitfeed` (visualisation, stale).
- **Specialised indexers**: `waterfalls` (descriptor-based scanning for web wallets), `frigate` (silent payments, privacy scope), BlindBit Oracle (silent payments; last release v0.1.0 on 2024-10-20, commits until 2026-09-23; privacy scope).
- **API gateway**: `btc-rpc-proxy` (per-application RPC permissions and on-demand fetching of pruned blocks).
- **Public data services**: `mempool-space-api`, `blockstream-info-api`. BTC RPC Explorer can also use blockchain.com, blockchair.com and blockcypher.com as external address APIs ([.env-sample](https://github.com/janoside/btc-rpc-explorer/blob/master/.env-sample)). Those are not recorded because BTCortex must never send wallet addresses to them.

### 1.2 Discontinued, superseded or stale

| Project | Status | Evidence |
|---|---|---|
| `electrum-server-legacy` (spesmilo/electrum-server) | Discontinued, superseded by `electrumx` | README: "This code is now unmaintained. The replacement code for electrum server is ElectrumX"; last commit 2021-03-08 |
| kyuupichan/electrumx (original) | Not the Bitcoin line | Last release 1.20.2 (2021-10-28), last commit 2022-12-30; README "For a future network with bigger blocks". The maintained fork is spesmilo/electrumx (`electrumx`), published on PyPI as `e-x` |
| `electrum-personal-server` | Stale, **verified incompatible** with Core ≥ 30 | Last release and commit 2022-06-16; `importmulti` in [deterministicwallet.py](https://github.com/chris-belcher/electrum-personal-server/blob/master/electrumpersonalserver/server/deterministicwallet.py); descriptor PR [#313](https://github.com/chris-belcher/electrum-personal-server/pull/313) unmerged |
| `bwt` | Stale, **verified incompatible** with Core ≥ 30 | Last release 2021-03-24, last commit 2022-03-31; `import_multi` in [wallet.rs](https://github.com/bwt-dev/bwt/blob/master/src/wallet.rs) |
| `bitfeed` | Stale | Last release and commit 2022-06-13; hosted site still online |
| `btc-rpc-explorer` | Maintenance-only | Last tag 2025-07-02, last commit 2025-08-24; npm registry two releases behind |
| Bitcoin ABE (bitcoin-abe/bitcoin-abe) | Stale, not recorded | Last release v0.7.2 (2012-12-07), last commit 2021-03-28 |
| Hiro Chainhook (hirosystems/chainhook) | Not recorded (Stacks/ordinals-oriented event indexer) | Last commit 2025-07-02; "migration" tags until 2025-12-19 |

Spectrum (cryptoadvance/spectrum, v0.8.0 on 2026-06-29) emulates the Bitcoin Core RPC interface on top of an Electrum server for Specter Desktop. It is the reverse direction and belongs with `specter-desktop`.

---

## 2. Electrum server comparison

| | Fulcrum 2.1.4 | electrs 0.12.0 | ElectrumX 2.0.0 |
|---|---|---|---|
| Language, licence | C++20/Qt, GPL-3.0-or-later | Rust, MIT | Python ≥ 3.10, MIT |
| Windows | Official x64 ZIP, statically linked ([release](https://github.com/cculianu/Fulcrum/releases/tag/v2.1.4)) | Source only; no Windows CI | "Won't run out-of-the-box on Windows" ([HOWTO](https://github.com/spesmilo/electrumx/blob/master/docs/HOWTO.rst)) |
| Docker | Official `cculianu/fulcrum` (amd64, arm64) | Community only (`getumbrel/electrs`); repository Dockerfile "for demonstration purposes" | Community `lukechilds/electrumx` (≤ 1.18.0); example Dockerfiles in `contrib/` |
| Bitcoin Core minimum | 0.17 (28.0 recommended for protocol 1.6) | **31.0** | **31.0** |
| `txindex` | **Required** (checked at start) | Not needed | **Required** |
| Other indexes | — | — | **`txospenderindex=1`** (Core 31) |
| REST | — | **`-rest=1` required** | — |
| ZMQ | Optional `zmqpubhashblock` (auto-discovered via `getzmqnotifications`) | None | None |
| Pruned node | No | No | No |
| RPC authentication | user/password, env vars, or **cookie file re-read on every reconnect** | cookie (default `<daemon_dir>/.cookie`) or `auth=USER:PASSWORD` (config file only) | user:password inside `DAEMON_URL` only |
| Protocol | 1.4–1.6 | 1.4 | 1.4–1.7 |
| Transports | TCP, SSL, WS, WSS | TCP only | TCP, SSL, WS, WSS |
| Default listener | TCP **0.0.0.0:50001** if unset | 127.0.0.1:50001 | none until `SERVICES` is set (host defaults to all interfaces) |
| TLS | PEM cert/key, RSA fully supported, hot reload | None (nginx stream or Tor) | `SSL_CERTFILE`/`SSL_KEYFILE` |
| Admin / monitoring | Admin JSON-RPC (after sync), `/stats` HTTP (from start-up) | Prometheus `127.0.0.1:4224` | LocalRPC `localhost:8000` (`electrumx_rpc`) |
| Peer discovery default | On (`peering`, `announce`) | None | On (`PEER_DISCOVERY=on`) |
| Configuration | `key = value` file + CLI (`_ENV_` for env) | TOML files + `ELECTRS_*` env + CLI | Environment variables only |
| Mainnet index size | 133 GB (README, Aug 2023); **166 GB** user report (2025-10-14) | **~56 GB** (July 2026; ~7 % of blocks, up to ~14 % before compaction) | **122 GiB** LevelDB / **106 GiB** RocksDB (~height 950 000, July 2026) |
| Extra node indexes | txindex ≈ 66 GiB | none | txindex ≈ 66 GiB + txospenderindex ≈ 88 GiB |
| RAM | ≥ 1 GB; `db_mem` = min(2048 MiB, 25 % RAM) | Low after sync | ~2 GB sync (GIL) / ~8 GB free-threaded |
| Initial index | "4 hours to 20+ hours" (SSD; README, undated) | ~2 h on 6 cores/32 GB/NVMe; ~18 h on ODROID-HC1 | "a bit less than half" with free-threaded Python (changelog); ~1 week on a Raspberry Pi 4 in 2022 |
| Crash safety and maintenance | 2.x: kill at any time, at most a few blocks rolled back | Single RocksDB; `auto_reindex` rebuilds inconsistent DBs | 2.0 removed the yearly "flush_count overflow" compaction downtime |
| Recommended for BTCortex | **Local, native, P1** | Connected; WSL2 opt-in for ~1 TB disks | Connected (remote/public servers) |

A 2022 benchmark by Sparrow ([server performance](https://www.sparrowwallet.com/docs/server-performance.html), Raspberry Pi 4, ElectrumX 1.16 / electrs 0.9.4 / Fulcrum 1.6.0) measured Fulcrum loading a 3 000-address wallet in about 1.4 s against about 40–54 s for ElectrumX and about 320–430 s for electrs. Sparrow recommends Fulcrum and suggests electrs only for very limited disk space and small wallets. The numbers are old, but the architectural reason still applies: electrs stores only heights per script hash and re-reads transactions from bitcoind on every query.

---

## 3. Fulcrum: integration details (P1, `fully-managed`)

### 3.1 Release, Windows assets and verification

- 2.1.4 was published **2026-10-18** ([GitHub API](https://api.github.com/repos/cculianu/Fulcrum/releases?per_page=4)). Assets: `Fulcrum-2.1.4-win64.zip` (17 168 090 bytes), `-x86_64-linux.tar.gz`, `-arm64-linux.tar.gz`, `-src.tar.gz`, `Fulcrum-2.1.4-shasums.txt` and `.asc`. There is no macOS binary.
- The Windows ZIP contains a statically linked `Fulcrum.exe` (jemalloc, libzmq, libminiupnpc, Qt 6.10, OpenSSL 3.3.0, gcc 15.2.0) and `FulcrumAdmin.exe`, the Python admin script packed with PyInstaller. Upstream warns that antivirus heuristics have flagged `FulcrumAdmin.exe` (issue #203). BTCortex does not need it: it can speak the admin protocol directly (§3.5).
- **Verification (checked on 2026-10-21).** `Fulcrum-2.1.4-shasums.txt` is signed by Calin Culianu's **DSA-2048** key `D465 135F 97D0 047E 18E9 9DC3 2181 0A54 2031 C02C` (created 2017-08-20, uid "Calin Culianu (NilacTheGrim)"), published at [Electron-Cash/keys-n-hashes](https://github.com/Electron-Cash/keys-n-hashes/blob/master/pubkeys/calinkey.txt). `gpg --verify` in an isolated keyring reported a good signature. The SHA-256 of the 2.1.4 Windows ZIP is `9e8b0435dae0c4be7b5c48df0c4e650b585cb1ac7b34013f16e682d39889f736`. BTCortex should pin the fingerprint and verify natively. Whether OpenPGP.js handles this DSA signature is an open question. Authenticode signing of `Fulcrum.exe` was not checked.
- Upgrade notes: use **≥ 2.1.1 on Windows**, which fixes Win32 handle-exhaustion spam with BTC (issue #324). 2.1.4 adds `history_lookup_threads` (default 8), with 5–10× faster uncached history lookups.

### 3.2 Bitcoin Core settings

From the [README](https://github.com/cculianu/Fulcrum/blob/master/README.md) and [Controller.cpp](https://github.com/cculianu/Fulcrum/blob/master/src/Controller.cpp):

- `txindex=1` is **required**. After the first sync Fulcrum asks for the first transaction after genesis and prints "txindex verification failed" if the node cannot serve it.
- The node **must not be pruning**.
- RPC must be enabled. Authentication is `rpcuser`/`rpcpassword` (config, CLI or the `RPCUSER`/`RPCPASSWORD` environment variables) or `rpccookie=<path>`. The cookie "will be read and re-parsed each time we (re)connect to bitcoind" ([App.cpp](https://github.com/cculianu/Fulcrum/blob/master/src/App.cpp)), so Core restarts are handled.
- ZMQ is optional but recommended (`zmqpubhashblock`). Fulcrum discovers the endpoint itself through `getnetworkinfo` and `getzmqnotifications` ([BitcoinD.cpp](https://github.com/cculianu/Fulcrum/blob/master/src/BitcoinD.cpp)). `hashtx` is used only with `zmq_allow_hashtx=true`, which the author advises against.
- Core ≥ 28.0 is recommended for full protocol 1.6 support (`broadcast_package` uses `submitpackage`).
- Supported chains ([BTC.cpp](https://github.com/cculianu/Fulcrum/blob/master/src/BTC.cpp)): main, test (testnet3), testnet4, signet, regtest.
- `bitcoind_clients` defaults to 3, which is well within Core's default 16 `rpcthreads`.

### 3.3 Managed configuration (example generated by BTCortex)

The keys are upstream's ([example config](https://github.com/cculianu/Fulcrum/blob/master/doc/fulcrum-example-config.conf)); the values are BTCortex policy. Paths use native backslashes. Behaviour with paths containing spaces or non-ASCII characters is not verified, so BTCortex should choose plain paths.

```ini
# Managed by BTCortex. Fulcrum mainnet profile.
datadir = D:\BTCortex\fulcrum\mainnet
bitcoind = 127.0.0.1:8332
rpccookie = C:\Users\<user>\AppData\Local\Bitcoin\.cookie
tcp = 127.0.0.1:50001
ssl = 127.0.0.1:50002
cert = D:\BTCortex\fulcrum\tls\fulcrum-cert.pem
key = D:\BTCortex\fulcrum\tls\fulcrum-key.pem
admin = 127.0.0.1:50010
stats = 127.0.0.1:50011
peering = false
announce = false
db_mem = 1024
ts_format = utc
```

Notes:

- `tcp` must be set explicitly. The documented default is `0.0.0.0:50001`, which exposes the server to the LAN and triggers a Windows Defender Firewall prompt (expected Windows behaviour, not reproduced).
- `peering`/`announce` default to true and false-if-no-hostname respectively. Peering makes outbound connections to public Electrum servers, so turn it off for a private server.
- `upnp` is off by default and must stay off.
- Admin and stats ports have no upstream defaults (examples use 8000 and 8080, which often collide). BTCortex should allocate free ports and record them.
- `db_mem`: 2.0 made the default min(2048 MiB, 25 % of RAM). The man page still says 1024. During the initial sync a temporarily larger value speeds things up (release notes).

### 3.4 Ports, TLS and certificates

- Conventional ports: 50001 TCP, 50002 SSL, 50003 WS, 50004 WSS (testnet 60001–60004). Client ports are **bound only after the initial synchronisation** ("Connection refused" until then).
- `cert`/`key` are PEM files. "Only RSA keys are fully supported. EC, DH, and DSA keys are supported, but their support is experimental." The native Windows binary does **not** generate a certificate. The Docker entrypoint creates an RSA-2048, 365-day certificate (`openssl req -newkey rsa:2048 ... -days 365 -subj "/O=Fulcrum"`) ([entrypoint](https://github.com/cculianu/Fulcrum/blob/master/contrib/docker/docker-entrypoint.sh)).
- BTCortex policy: generate an RSA certificate once (for example RSA-3072, ten-year validity, SAN `127.0.0.1` and `localhost`, plus the onion host if used). Keep it stable across restarts and upgrades, because clients pin it (§13). Record its SHA-256 DER fingerprint.
- Certificates can be swapped without a restart ([SSLCertMonitor.h](https://github.com/cculianu/Fulcrum/blob/master/src/SSLCertMonitor.h)). `wss_cert`/`wss_key` allow a CA-signed certificate for browsers while the SSL port keeps a self-signed one. `tls_disallow_deprecated=true` restricts TLS to 1.2 or later.

### 3.5 Admin RPC, `/stats` and health checks

- **`/stats` HTTP** (`stats=`) starts in `App::startup()` **before** synchronisation ([App.cpp](https://github.com/cculianu/Fulcrum/blob/master/src/App.cpp)). It is the progress source during initial sync. It returns a JSON tree with sections such as "Bitcoin Daemon", "Controller", "Storage", "Server Manager", "SubsMgr", "Jemalloc" and "simdjson". `/debug` also exists.
- **Admin RPC** (`admin=`) is started by `SrvMgr::startServers()` together with the client servers, i.e. **only after the first "up to date" state** ([Controller.cpp](https://github.com/cculianu/Fulcrum/blob/master/src/Controller.cpp) defers `srvmgr->startup()`, [SrvMgr.cpp](https://github.com/cculianu/Fulcrum/blob/master/src/SrvMgr.cpp)). The protocol is newline-terminated JSON-RPC 2.0 over plain TCP, as used by [FulcrumAdmin](https://github.com/cculianu/Fulcrum/blob/master/FulcrumAdmin): `{"id": 1, "jsonrpc": "2.0", "method": "getinfo", "params": []}\n`. Methods: `addpeer`, `ban`, `banpeer`, `bitcoind_throttle`, `clients`, `getinfo`, `kick`, `listbanned`, `loglevel`, `maxbuffer`, `peers`, `query`, `rmpeer`, `simdjson`, `stop` (returns `true`), `unban`, `unbanpeer`. It has no authentication, and Fulcrum warns if it is bound to a non-loopback interface.
- **Health states** for BTCortex:
  1. *process running, `/stats` unreachable*: starting or crashed (check the log);
  2. *`/stats` reachable, client port closed*: indexing (compare the indexed height in `/stats` with `getblockcount`);
  3. *client port open*: run the Electrum probe (§14);
  4. *admin `getinfo` reachable*: fully up, management available.

### 3.6 Lifecycle on Windows

- **Start**: `Fulcrum.exe <path>\fulcrum.conf` as a supervised child with stdout/stderr captured. Fulcrum logs only to stdout; `syslog` has no effect on Windows. `ts_format=utc` gives unambiguous timestamps. There is no service mode; BTCortex is the supervisor.
- **Graceful stop**: send admin `stop` (available once synchronised). The process handles SIGINT/SIGTERM through `std::signal`. On Windows SIGINT corresponds to a console Ctrl+C event, which is hard to deliver to a child process without a console. Whether a CTRL_C_EVENT delivered through `AttachConsole`/`GenerateConsoleCtrlEvent` works was not tested.
- **During the initial sync**, where admin is not yet available, rely on the 2.x guarantee: "the process can be killed at any time (including abrupt powerloss), without any database corruption. At worst the last few blocks worth of data is rolled-back" ([2.1.0 notes](https://github.com/cculianu/Fulcrum/releases.atom)). Upstream still recommends a graceful shutdown for faster restarts.
- **Exception: the 1.x → 2.x upgrade.** `--db-upgrade` is one-time, irreversible and must not be interrupted: signals are ignored and killing it corrupts both databases. It takes about an hour or more on BTC mainnet and needs extra free space (issue [#304](https://github.com/cculianu/Fulcrum/issues/304): the tool asked for 14.7 GB, and the author advised about 24 GB more). For zero-touch, BTCortex should prefer a fresh 2.x datadir when space allows, and otherwise run the upgrade only with an explicit warning, on mains power, with Windows sleep prevented.
- **Reindex triggers**: switching to a different chain (Fulcrum detects `chain` changes) or a datadir from another network. Fulcrum 2.x datadirs are platform-neutral and can be copied between Windows and Linux (2.0 notes).
- **Logoff and shutdown**: BTCortex must stop Fulcrum before bitcoind (spec 17.2 ordering). Stop order: wallets → Fulcrum → bitcoind.

### 3.7 Sizing and hardware-aware defaults (BTCortex policy)

Inputs: free space on the index volume, total RAM, SSD or HDD, and whether the node is pruned.

- **Gate**: never offer Fulcrum on a pruned node. Check `getblockchaininfo.pruned == false` and `getindexinfo.txindex.synced == true`. If `txindex` is off, plan a background build: Core builds the index after `txindex=1` and a restart, and `getindexinfo` reports `synced: false` until it is done (as ElectrumX's checker and ord's guide describe).
- **Disk estimate** (late 2026, an estimate): Fulcrum index ≈ 170–200 GB, plus Core `txindex` ≈ 70 GB, plus 20 % headroom. Recheck against real sizes after implementation.
- **RAM**: keep the upstream default `db_mem` on machines with 16 GB or more. With 8 GB or less, use `db_mem = 512–1024` alongside bitcoind's `dbcache`. Upstream says even 256 works well on an SSD.
- **HDD**: warn that the initial sync "will probably take days".

### 3.8 Zero-touch installation procedure

1. Preconditions: unpruned managed node, enough disk (§3.7), Windows 10 x64 or later.
2. Download the ZIP, `shasums.txt` and `.asc` for the pinned version. Verify the signature against the pinned fingerprint, then the SHA-256.
3. Extract to `%LOCALAPPDATA%\BTCortex\runtimes\fulcrum\<version>\`. No administrator rights, no registry entries.
4. Generate the TLS key and certificate (§3.4) and the configuration file (§3.3).
5. Change the node: `txindex=1` and `zmqpubhashblock=tcp://127.0.0.1:<port>`. Restart Core and wait for `getindexinfo` `txindex.synced`.
6. Start Fulcrum, poll `/stats`, and show progress with an ETA based on blocks per second.
7. When the client port opens, run the Electrum probe and then enable wallet pre-configuration (§13).
8. Upgrades: download the new version side by side, stop through admin `stop`, then switch. Same-major (2.x) upgrades keep the datadir.

---

## 4. electrs: integration details (P1, `connected-application`; `managed-wsl2` opt-in)

### 4.1 Release, build and Windows status

- 0.12.0 was published **2026-09-13**. It switches to [bindex](https://github.com/romanz/bindex-rs): "requires Bitcoin Core 31+", "uses REST API server (`-rest=1`)", "new index format - requires reindexing!" ([release](https://github.com/romanz/electrs/releases/tag/v0.12.0), [RELEASE-NOTES](https://github.com/romanz/electrs/blob/master/RELEASE-NOTES.md)). 0.11.0 (2025-11-17) had already forced a reindex through the RocksDB 9.10 upgrade.
- **No binaries for any platform** ([binaries.md](https://github.com/romanz/electrs/blob/master/doc/binaries.md)). A contributor runs a beta Debian repository. Build needs Rust ≥ 1.85 and libclang. RocksDB is statically linked by default; dynamic linking needs RocksDB 9.10.0.
- **Windows**: `Cargo.toml` has a Windows-only `ctrlc` dependency (0.10.8, PR [#1123](https://github.com/romanz/electrs/pull/1123), December 2024). That PR added a Windows CI build *without* the Prometheus metrics feature ("Prometheus doesn't work on Windows", contributor statement). The current [CI workflow](https://github.com/romanz/electrs/blob/master/.github/workflows/rust.yml) builds only on `ubuntu-latest`, so a native Windows build is unsupported and untested upstream.

### 4.2 Bitcoin Core settings (0.12.0)

- **Core ≥ 31.0** with **`rest=1`**: bindex reads `/rest/blockhashbyheight`, `/rest/headers`, `/rest/block`, `/rest/spenttxouts` (Core 30.0) and `/rest/blockpart` (Core 31.0) ([client.rs](https://github.com/romanz/bindex-rs/blob/master/bindex-lib/src/client.rs), [upgrading.md](https://github.com/romanz/electrs/blob/master/doc/upgrading.md)).
- `server=1` (JSON-RPC for mempool, broadcast and fees) with the cookie (recommended upstream) or `auth=USER:PASSWORD`, which is accepted only in config files.
- **`prune=0`**. `txindex` is "allowed but unnecessary". No ZMQ.
- 0.9–0.11 used P2P (`daemon_p2p_addr`, default 127.0.0.1:8333, with `whitelist=download@127.0.0.1` advised); 0.12 removed it. Anyone pinning 0.11.x keeps the P2P requirement.

### 4.3 Configuration

TOML files are loaded in priority order `/etc/electrs/config.toml`, `~/.electrs/config.toml`, `./electrs.toml`, then `ELECTRS_*` environment variables, then arguments. `--conf`/`--conf-dir` override everything given before them ([config.md](https://github.com/romanz/electrs/blob/master/doc/config.md)). The **default `daemon_dir` is `~/.bitcoin` on every OS** ([config.rs](https://github.com/romanz/electrs/blob/master/src/config.rs)), so BTCortex must always set `daemon_dir`/`cookie_file` and start with `--skip-default-conf-files`.

Example for a BTCortex-managed WSL2 instance (the keys are upstream's; the values are policy; `172.x.y.1` stands for the Windows host address seen from WSL2):

```toml
# Managed by BTCortex. electrs mainnet in WSL2.
network = "bitcoin"
db_dir = "/var/lib/btcortex/electrs/db"
daemon_rpc_addr = "172.x.y.1:8332"
auth = "electrs:<generated password>"   # rpcauth user on the Windows node (alternative: cookie_file through the /mnt/c mount; not tested)
electrum_rpc_addr = "0.0.0.0:50001"     # WSL2 VM interface; reached from Windows via localhost forwarding (not tested)
monitoring_addr = "127.0.0.1:4224"
log_filters = "INFO"
```

`daemon_dir` is omitted because it is only used to derive the default cookie path; whether electrs 0.12 needs it at all when `auth` is set was not verified.

### 4.4 Ports and monitoring

- Electrum: 50001 mainnet, 60001 testnet3, 40001 testnet4, 60401 regtest, 60601 signet, all on 127.0.0.1 by default.
- Prometheus: 4224, 14224, 44224, 24224, 34224 respectively (`index_height` among the metrics; [monitoring.md](https://github.com/romanz/electrs/blob/master/doc/monitoring.md)).
- `server.version` returns `["electrs/0.12.0", "1.4"]` (`server_id()` in [electrum.rs](https://github.com/romanz/electrs/blob/master/src/electrum.rs); the usage guide's example prints it without the slash). `blockchain.scripthash.get_mempool` is not implemented.

### 4.5 WSL2 deployment design

- From the [Microsoft WSL networking documentation](https://learn.microsoft.com/en-us/windows/wsl/networking): in the default **NAT** mode, Windows reaches services inside WSL2 at `localhost` (Sparrow on Windows can use `127.0.0.1:50001`). Linux reaches Windows services only through the host IP (`ip route show | grep -i default`), and "you may need to bind your application to `0.0.0.0` instead of `127.0.0.1`".
- **Mirrored mode** (`networkingMode=mirrored`), which allows `127.0.0.1` in both directions, requires **Windows 11 22H2 or later**. The test machine runs Windows 10 19045, so it is NAT only.
- Consequence on Windows 10: the native node must listen for RPC/REST on the vEthernet (WSL) adapter, with `rpcbind=<vEthernet IP>` and `rpcallowip=<WSL subnet>`. The unauthenticated REST interface is then reachable from the WSL VM network. Mitigations: a dedicated rpcauth user for electrs; keeping the node's LAN interfaces unbound; documenting the exposure; or running the node inside the same WSL2 distribution (which conflicts with the native-first rule and puts ~800 GB into a VHDX).
- The vEthernet address can change across reboots, so BTCortex must regenerate `rpcbind` and electrs' `daemon_rpc_addr` at every start (expected WSL behaviour, not tested).
- The Hyper-V firewall applies on Windows 11 22H2 or later with WSL 2.0.9 or later.

### 4.6 Upgrade and reindex caveats

- 0.12.0 changed the index format and needs at least **120 GB free** for the mainnet reindex, during which "electrs will be unable to serve your requests for a few hours".
- `auto_reindex` (default true) rebuilds silently. BTCortex should start with `--no-auto-reindex` during upgrades, detect the format mismatch and ask the user first.
- Umbrel still shipped 0.11.1 on 2026-10-21 ([manifest](https://github.com/getumbrel/umbrel-apps/blob/master/electrs/umbrel-app.yml)). Expect mixed versions on node platforms when connecting.

---

## 5. ElectrumX (P2, `connected-application`)

- 2.0.0 was released on 2026-07-03 ([changelog](https://github.com/spesmilo/electrumx/blob/master/docs/changelog.rst)): new DB schema (resync from genesis, no migration), mandatory `DB_ENGINE` (leveldb or rocksdb via the revived `rocksdb-ng`), protocol 1.7, experimental free-threaded Python.
- For `COIN=Bitcoin` it requires **Core ≥ 31.0 with `txindex` and `txospenderindex`**, checked via `getindexinfo` ([coins.py](https://github.com/spesmilo/electrumx/blob/master/src/electrumx/lib/coins.py), [daemon.py](https://github.com/spesmilo/electrumx/blob/master/src/electrumx/server/daemon.py)).
- Configuration is environment variables only ([environment.rst](https://github.com/spesmilo/electrumx/blob/master/docs/environment.rst)): `COIN`, `NET`, `DB_DIRECTORY`, `DB_ENGINE`, `DAEMON_URL=http://user:pass@127.0.0.1:8332/`, `SERVICES=tcp://127.0.0.1:50001,ssl://127.0.0.1:50002,rpc://` (an omitted host means all interfaces), `SSL_CERTFILE`/`SSL_KEYFILE`, `PEER_DISCOVERY=self`, `PEER_ANNOUNCE=` (empty). LocalRPC: `electrumx_rpc getinfo|sessions|peers|stop` on localhost:8000.
- No cookie authentication was found, so the RPC password sits in the environment. Use a dedicated rpcauth user.
- Windows: not supported. WSL2 is plausible but untested. Its value to BTCortex is mainly as a remote server that BTCortex connects to and health-checks.

---

## 6. Wallet-scoped personal servers: why EPS and bwt are unsupported

- EPS's setup creates a legacy wallet (`bitcoin-cli createwallet electrumpersonalserver true true "" false false true`, so `descriptors=false`) and imports with `importmulti`. bwt imports with `importmulti`.
- Bitcoin Core 30.0: "the legacy-only RPCs addmultisigaddress, dumpprivkey, dumpwallet, importaddress, importmulti, importprivkey, importpubkey, importwallet, newkeypool, sethdseed, and upgradewallet, are removed", and BDB legacy wallets can no longer be created or loaded ([30.0 release notes](https://bitcoincore.org/en/releases/30.0/)).
- Both tools are therefore **unsupported** with Core 30.x and 31.x. EPS PR #313 (descriptor wallets with legacy fallback, 2025-12-07) is unreviewed and unmerged.
- EPS also ships a default TLS certificate whose key is public ([README](https://github.com/chris-belcher/electrum-personal-server/blob/master/README.md)) and serves one client at a time.
- Replacements for pruned machines: Sparrow's direct Bitcoin Core connection (descriptor watch-only wallet `cormorant`; see `sparrow` and the `full-nodes-core` notes §13) and Floresta's built-in Electrum server and watch-only wallet ([README](https://github.com/getfloresta/Floresta): "a watch-only wallet and an Electrum server"; alternatives scope).

---

## 7. Esplora and its back ends

- **`blockstream-electrs`** (branch `new-index`, [README](https://github.com/Blockstream/electrs/blob/new-index/README.md)): extended indexes (raw transactions, address prefix search, spendable outputs, block metadata), Esplora HTTP API on 127.0.0.1:3000 (or a Unix socket), Electrum 1.4, Prometheus on 4224 (54224 signet). No `txindex` needed: it reads `blk*.dat` directly (`--daemon-dir`/`--blocks-dir`) unless `--jsonrpc-import` is used. `--cookie` takes `USER:PASSWORD`. Storage: 610 GB after compaction in June 2020, double that free during compaction; `--lightmode` about half. There are no releases for this line; the 2018 tags predate the fork.
- **`mempool-electrs`** ([README](https://github.com/mempool/electrs/blob/mempool/README.md)): the same design with mempool extensions; 1.3 TB after compaction (October 2023); official `mempool/electrs` image; v3.3.0 (2026-01-01) adds `blockchain.scripthash.unsubscribe` and an `X-Bitcoin-Version` REST header.
- **`esplora`**: the official `blockstream/esplora` image runs its **own** bitcoind, esplora-electrs, nginx (switched to `user root` by `run.sh`), a pre-renderer, a WebSocket service, Tor and socat under runit, with data under `/data` ([run.sh](https://github.com/Blockstream/esplora/blob/master/run.sh)). Flavours: `bitcoin-mainnet`, `bitcoin-testnet`, `bitcoin-testnet4`, `bitcoin-signet`, `bitcoin-regtest` and Liquid variants. Options: `ENABLE_LIGHTMODE=1`, `NO_PRECACHE=1`, `NO_ADDRESS_SEARCH=1`, `ONION_URL`. A second full node next to the managed one is not sensible on a desktop.
- **Recommendation**: implement an **Esplora API client** in BTCortex (the [API](https://github.com/Blockstream/esplora/blob/master/API.md) is small and stable). Use it against local or remote esplora-electrs and mempool-electrs, the mempool back end's Esplora-style paths, and, opt-in and labelled, blockstream.info or mempool.space.

---

## 8. mempool (P1, `managed-docker`)

- Deployment: official images `mempool/frontend` and `mempool/backend` v3.3.1 (amd64, arm64) and the [reference compose file](https://github.com/mempool/mempool/blob/master/docker/docker-compose.yml) with services `web` (8080 → 80), `api` (8999) and `db` (`mariadb:10.5.21`), plus health checks (`curl -f http://localhost:8999/api/v1/backend-info`).
- Bitcoin Core: **`txindex=1`** and `server=1` even in Core-only mode ([docker/README](https://github.com/mempool/mempool/blob/master/docker/README.md), [backend/README](https://github.com/mempool/mempool/blob/master/backend/README.md)). Cookie authentication is supported through `CORE_RPC.COOKIE`/`COOKIE_PATH` ([config sample](https://github.com/mempool/mempool/blob/master/backend/mempool-config.sample.json)).
- `MEMPOOL_BACKEND`: `none` (no address lookups), `electrum` (romanz/electrs or Fulcrum; `ELECTRUM_HOST`, `ELECTRUM_PORT`, `ELECTRUM_TLS_ENABLED`) or `esplora` (Blockstream or mempool electrs). The mempool FAQ prefers Fulcrum over electrs for heavy addresses ([FAQ source](https://github.com/mempool/mempool/blob/master/frontend/src/app/docs/api-docs/api-docs.component.html)).
- Privacy defaults to change. `FIAT_PRICE.ENABLED` is true: the price updater polls Bitflyer, Kraken, Coinbase, Bitfinex and Gemini, and FreeCurrencyAPI with a key ([price-updater.ts](https://github.com/mempool/mempool/blob/master/backend/src/tasks/price-updater.ts)). `MEMPOOL_SERVICES.API` points at mempool.space. `SOCKS5PROXY` can route these fetches over Tor.
- Weak defaults to replace: RPC `mempool/mempool`, database `mempool/mempool`, MariaDB root password `admin`. Publish ports on 127.0.0.1 only.
- Container to host networking: the compose file reaches a host bitcoind through the Docker gateway (`172.27.0.1`). For a native Windows node this has the same RPC-exposure problem as WSL2 (§4.5) and must be designed with the container-runtime decision (`technology-platform` scope).
- Licence: AGPL-3.0-or-later (later versions only if approved by proxy statement) with an explicit **trademark reservation** ([LICENSE](https://github.com/mempool/mempool/blob/master/LICENSE)). BTCortex may name "mempool" factually but must not use its logos.

---

## 9. BTC RPC Explorer (P1, `fully-managed`)

- It is the only maintained explorer that runs natively on Windows and on a pruned node. Node.js 18 or later (22+ recommended). The only native dependency, `zeromq@6.5.0`, ships prebuilt `win32/x64`, `win32/arm64` and `win32/ia32` addons ([package listing](https://unpkg.com/zeromq@6.5.0/?meta)).
- **The npm registry lists 3.4.0 (2023-06-14) as latest, while GitHub has 3.5.0 and 3.5.1** (3.5.0 fixes the node-details page for Core 28.0 and later). The repository has no `package-lock.json` and two `github:` dependencies, so BTCortex should vendor a reviewed lockfile and install the tagged source with its own Node runtime.
- Pruned and no-txindex mode ([README](https://github.com/janoside/btc-rpc-explorer/blob/master/README.md)): transactions are found by txid only if they are in the mempool, recently confirmed (within `BTCEXP_NOTXINDEX_SEARCH_DEPTH`, default 3 blocks) or wallet-related; otherwise a block height is needed. Pruned blocks show only headers. Previous-output addresses and amounts and confirmed fees are missing.
- Managed environment (BTCortex policy): `BTCEXP_HOST=127.0.0.1`, a free `BTCEXP_PORT` (default 3002), `BTCEXP_BITCOIND_COOKIE=<network data directory>\.cookie`, `BTCEXP_PRIVACY_MODE=true`, `BTCEXP_NO_RATES=true`, `BTCEXP_RPC_ALLOWALL=false`, a generated `BTCEXP_BASIC_AUTH_PASSWORD` (or SSO token file) and `BTCEXP_COOKIE_SECRET`, and `BTCEXP_ADDRESS_API=electrum` with `BTCEXP_ELECTRUM_SERVERS=tcp://127.0.0.1:50001` only when a managed Electrum server exists. Never configure the blockchain.com, blockchair or blockcypher address APIs.
- Health check: HTTP 200 on `/` (or an `/api/...` route) with the basic-auth header.

---

## 10. NBXplorer (P2, `managed-docker`; part of the `btcpay-server` profile)

- Requirements ([Operator guide](https://github.com/btcpayserver/NBXplorer/blob/master/docs/Operator.md)): PostgreSQL ≥ 13 (mandatory; NBXplorer creates the database and applies migrations), Bitcoin Core ≥ 24.0, and the .NET 10 SDK to build. **Pruned nodes are supported**, because it indexes only registered wallets. Rescans need `--btcrescan` with `--btcstartheight` and can only cover retained blocks.
- It uses RPC plus a **P2P connection** (`btc.node.endpoint`, default 127.0.0.1:8333), which conflicts with the `listen=0` node profile (see contradiction 7).
- API ([API guide](https://github.com/btcpayserver/NBXplorer/blob/master/docs/API.md)): REST on 127.0.0.1:24444 under `/v1/cryptos/btc/...`, with events by polling, long polling or WebSocket. Authentication is HTTP Basic with the `username:password` in `.cookie`, regenerated at every start: `%APPDATA%\NBXplorer\Main\.cookie` on Windows; reload it on 401. Configuration lives at `%APPDATA%\NBXplorer\<Network>\settings.config` or in `NBXPLORER_*` variables.
- Distribution: the Docker image `nicolasdorier/nbxplorer` (2.6.19, amd64/arm64/arm). There are no release binaries. A native Windows build (`build.ps1`, `run.ps1`) is possible but would be BTCortex's own build.

---

## 11. Other indexers and explorers (P3)

- **`blockbook`** ([README](https://github.com/trezor/blockbook/blob/master/README.md)): Debian Linux AMD64 only. 32 GB RAM for the initial Bitcoin sync (10 GB afterwards) and more than 180 GB of index. The bundled back end uses `txindex=1`, `nolisten=1`, ZMQ `hashtx`/`hashblock` and Core 31.1. Ports for Bitcoin: public 9130, internal 9030, back-end RPC 8030, ZMQ 38330. OpenAPI at `/openapi.yaml`. WebSocket origin checks are off by default.
- **`bitcore-node`**: BitPay's multi-chain indexer with the Insight UI, needing MongoDB ≥ 3.4. Active (v11.10.14, 2026-10-19) but heavy and multi-chain.
- **`ord`** (0.29.1, 2026-10-19): native Windows ZIP, requires `-txindex`. Upstream warns that `ord server` hosts untrusted HTML/JavaScript and that ord wallets must be kept separate from wallets holding funds. Including it in the catalogue is a product decision.
- **`bitcoin-research-kit`** (Bitview, v0.12.2): Linux/macOS, reads `blk*.dat`, about 290 GiB and 16 GB RAM, UI and API on `localhost:3110`.
- **`waterfalls`** (0.10.0): descriptor-in, history-out scanning for web wallets; 245 GB database at height 911k.
- **`bitfeed`**: stale since 2022; needs unpruned, `txindex` and ZMQ `rawblock`/`rawtx`/`sequence`.
- **`btc-rpc-proxy`**: per-client RPC allow-lists and on-demand fetching of pruned blocks for RPC consumers. It does not help consumers that need `txindex`, REST or block files.

---

## 12. Public data services and the provider policy

| | mempool.space | blockstream.info |
|---|---|---|
| REST | `https://mempool.space/api/` (`/testnet4/api`, `/signet/api`), e.g. `/api/v1/fees/recommended`, `/api/blocks/tip/height` | `https://blockstream.info/api/` (`/testnet/api/`, `/signet/api/`, `/liquid/api/`); no testnet4 in [API.md](https://github.com/Blockstream/esplora/blob/master/API.md) |
| WebSocket | `wss://mempool.space/api/v1/ws` | — |
| Electrum | signet `mempool.space:60602`, testnet4 `mempool.space:40002` (SSL; per Sparrow's [server list](https://github.com/sparrowwallet/sparrow/blob/master/src/main/java/com/sparrowwallet/sparrow/net/PublicElectrumServer.java)) | `electrum.blockstream.info` 50002 SSL / 50001 TCP, `blockstream.info` 700 SSL / 110 TCP ([Electrum list](https://github.com/spesmilo/electrum/blob/master/electrum/chains/mainnet/servers.json)) |
| Onion | `http://mempoolhqx4isw62xs7abwphsq7ldayuidyx2v2oethdhhj6mlo2r6ad.onion/api/v1` ([official config sample](https://github.com/mempool/mempool/blob/master/backend/mempool-config.sample.json)) | `http://explorerzydxu5ecjrkwceayqybizmpjjznk5izmitf2modhcusuqlid.onion/` (`Onion-Location` header observed on 2026-10-21) |
| Limits | Enforced, unpublished; HTTP 429, repeated abuse "may be banned" | Free-tier limits on REST and Electrum since 2026-04-22 ([blog](https://blog.blockstream.com/enhanced-analytics-and-infrastructure-improvements-for-the-blockstream-explorer-api/)); paid tiers, Enterprise "unlimited" |
| Authentication | None (Enterprise sponsorship for higher limits) | None for free; Enterprise uses `client_id`/`client_secret` → access tokens (default 5 min, max 300 min) |
| Observed on 2026-10-21 | Connection reset from the research VPN | `/api/blocks/tip/height` → 972403 |

**Policy for BTCortex** (spec section 12: "Prefer local data providers. Clearly indicate whenever information comes from an external service."):

1. Data source order: the local node (RPC/REST), then the local Electrum server or Esplora API, then remote servers the user owns (connected applications), and only then public services, which are off by default.
2. Public services may be enabled per data type (fee estimates, tip height, price) with an explanation. **Never** send addresses, script hashes, xpubs or txids of wallet transactions to them by default.
3. Prefer onion endpoints when Tor is available. Every value shown carries its provider and timestamp; external ones are visibly marked.
4. Handle 429s and connection resets with back-off and a visible "provider unavailable" state. Never silently fall back from local to external.
5. Spec section 12 also says address lookups should appear only when the backend supports them. Bitcoin Core offers no general address index, so address or script-hash search appears only with a connected Electrum server, Esplora API or NBXplorer-tracked wallet.

---

## 13. Connecting wallets (server side of spec section 7)

- **Sparrow** (`sparrow`):
  - Pins self-signed certificates on first use. Without a stored certificate it accepts the server certificate (after checking validity; an unknown *expired* certificate raises a prompt), then stores the PEM in `<Sparrow data directory>\certs\<host>`. Later connections trust only that certificate. Private servers may keep using an expired pinned certificate ([TcpOverTlsTransport.java](https://github.com/sparrowwallet/sparrow/blob/master/src/main/java/com/sparrowwallet/sparrow/net/TcpOverTlsTransport.java), [Storage.java](https://github.com/sparrowwallet/sparrow/blob/master/src/main/java/com/sparrowwallet/sparrow/io/Storage.java)).
  - Config keys include `serverType`, `electrumServer`, `electrumServerCert` and `useProxy`/`proxyServer` ([Config.java](https://github.com/sparrowwallet/sparrow/blob/master/src/main/java/com/sparrowwallet/sparrow/io/Config.java)).
  - `.onion` hosts use Sparrow's internal Tor unless a proxy is configured.
  - Sparrow offers protocol versions `1.3` and `1.4.2` and enables batching depending on the `server.version` string ("fulcrum" ≥ 1.6.0, "electrs/" ≥ 0.9.0, "mempool-electrs" > 3.1.0, "electrumx", "frigate"; [ElectrumServer.java](https://github.com/sparrowwallet/sparrow/blob/master/src/main/java/com/sparrowwallet/sparrow/net/ElectrumServer.java)).
  - **Server-side requirement**: keep the TLS certificate stable. A regenerated certificate breaks the pin.
- **Electrum** (`electrum`): data directory `%APPDATA%\Electrum` on Windows (or `ELECTRUMDIR`) ([util.py](https://github.com/spesmilo/electrum/blob/master/electrum/util.py)). Config keys `server` (`127.0.0.1:50002:s`; `:t` for TCP), `oneserver` (true for your own server: "full trust"), `auto_connect` (false), `proxy` (`socks5:127.0.0.1:9050`), and **`serverfingerprint`**: the SHA-256 of the DER certificate, which pins a self-signed server and requires `server` to be set ([simple_config.py](https://github.com/spesmilo/electrum/blob/master/electrum/simple_config.py), [interface.py](https://github.com/spesmilo/electrum/blob/master/electrum/interface.py)). Pinned certificates live under `<electrum dir>\certs\`. Protocol 1.4–1.6 ([version.py](https://github.com/spesmilo/electrum/blob/master/electrum/version.py)). Since 4.7.0 it refuses servers with a different genesis hash.
- **Endpoint generation** (BTCortex): for each managed server emit `{host, port, protocol: tcp|ssl, certificatePath, sha256Fingerprint, onion?}`. Use loopback for local wallets; for remote wallets use the onion endpoint (Tor `HiddenServicePort 50001 127.0.0.1:50001`; TLS is optional over onion) or a private network. Never use a LAN bind without explicit consent.

---

## 14. Health checks and monitoring

**Electrum probe** (works for every server; newline-delimited JSON-RPC over TCP or TLS):

```text
→ {"jsonrpc":"2.0","id":1,"method":"server.version","params":["BTCortex",["1.4","1.6"]]}
← {"jsonrpc":"2.0","id":1,"result":["Fulcrum 2.1.4","1.6"]}       (electrs answers ["electrs/0.12.0","1.4"])
→ {"jsonrpc":"2.0","id":2,"method":"server.features","params":[]}
← genesis_hash must equal the node's block 0 hash (mainnet 000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f)
→ {"jsonrpc":"2.0","id":3,"method":"blockchain.headers.subscribe","params":[]}
← {"height":<n>,"hex":"<80-byte header>"}  → compare n with bitcoind getblockcount (lag > 2 blocks = degraded)
→ {"jsonrpc":"2.0","id":4,"method":"server.ping","params":[]}       (keep-alive)
```

Rules: `server.version` must be the first message (mandatory from 1.6), sent once per connection. Over TLS, verify the pinned fingerprint before sending anything. The Fulcrum version string shown above is inferred from its `AppSubVersion` format ("Fulcrum 2.1.4"; [ServerMisc.cpp](https://github.com/cculianu/Fulcrum/blob/master/src/ServerMisc.cpp)) and from Sparrow's parser, which strips a leading "fulcrum"; it was not observed on a live server.

**Server-specific signals**: Fulcrum `/stats` during sync and admin `getinfo` afterwards; electrs Prometheus `index_height`; ElectrumX `electrumx_rpc getinfo`; mempool `GET /api/v1/backend-info`; NBXplorer authenticated status endpoint (path to confirm); BTC RPC Explorer HTTP 200 with basic auth; Blockbook public port with OpenAPI.

---

## 15. The test machine (5.9 GB RAM, ~73 GB free, pruned mainnet node)

| Component | Works? | Why |
|---|---|---|
| Fulcrum, electrs, ElectrumX | No | Full chain required (and txindex for Fulcrum/ElectrumX) |
| EPS, bwt | No | Incompatible with Core ≥ 30 |
| mempool, Esplora, Blockbook, Bitfeed, ord, BRK | No | Unpruned chain or txindex required |
| BTC RPC Explorer | **Yes, reduced** | Pruned/no-txindex mode on Core ≥ 0.21 (§9) |
| NBXplorer | Yes | Wallet-scoped; PostgreSQL needed; P2P listen on loopback |
| Sparrow → Core directly | Yes (wallet scope) | New wallets only; restoring old seeds needs an unpruned node |
| Remote Electrum server (node platform, own server) | Yes | `connected-application` over Tor, SSH or a private network |
| Public services | Opt-in only | Privacy; external labelling |

---

## 16. Recommended integration approach and support levels

1. **`fulcrum`: `fully-managed`, P1.** The only native Windows Electrum server: signed checksums, portable ZIP, flat configuration file, cookie re-read, `/stats` during sync, admin RPC afterwards, crash-safe database. It is BTCortex's default local Electrum server whenever the node is unpruned and the disk allows (§3.7).
2. **`electrs`: `connected-application`, P1, with `managed-wsl2` as an opt-in.** It is the most common server on node platforms, so connecting to existing instances is the first deliverable. Locally it beats Fulcrum on disk (about 56 GB, no txindex) but needs WSL2 (with the RPC/REST exposure trade-off on Windows 10) and Core ≥ 31. A BTCortex-built Windows binary is a research spike.
3. **`btc-rpc-explorer`: `fully-managed`, P1.** A native Node.js process works with pruned nodes. Pin and vendor dependencies; harden the defaults.
4. **`mempool`: `managed-docker`, P1**, for Profile D/G/H machines with an unpruned node, txindex and a managed Electrum back end (Fulcrum preferred). It depends on the container-runtime decision.
5. **`electrumx`: `connected-application`, P2.** Remote/public servers only.
6. **`nbxplorer`: `managed-docker`, P2**, together with BTCPay Server. Coordinate the node P2P setting.
7. **Esplora family, Blockbook: `connected-application`, P3.** Implement an Esplora API client for BTCortex's explorer and connect to existing instances; do not deploy them on desktops.
8. **Public services: `connected-application`, P2/P3**, opt-in and labelled (§12).
9. **EPS, bwt, legacy electrum-server: `unsupported`.** Detect them and explain the replacement.
10. **BTCortex's native explorer (spec section 12)**: build it on Bitcoin Core RPC (blocks, transactions, mempool, fees, raw and script inspection; pruned and no-txindex limits shown explicitly) and add address/script-hash lookup through the connected Electrum server (protocol 1.4 baseline) or Esplora API.

---

## 17. Windows-specific pitfalls

- **Default binds**: Fulcrum's default TCP bind is `0.0.0.0`, so write loopback binds or expect a firewall prompt and LAN exposure. ElectrumX `SERVICES` without a host means all interfaces.
- **No Windows service mode** for any of these servers. BTCortex supervises the processes and must stop them before bitcoind on logoff or shutdown (`WM_QUERYENDSESSION`, see the `full-nodes-core` notes).
- **Graceful stop of Fulcrum** depends on the admin port, which is unavailable during the initial sync. Console control events to child processes are unreliable (open question).
- **Antivirus**: `FulcrumAdmin.exe` false positives. Real-time scanning of multi-hundred-GB RocksDB directories may slow indexing (expected, not measured). BTCortex must not add Defender exclusions automatically (spec 17.3); it may explain the trade-off to the user.
- **WSL2 networking**: NAT only on Windows 10; mirrored mode needs Windows 11 22H2 or later. The vEthernet address may change. A Windows-hosted RPC/REST endpoint must be exposed to the WSL subnet. Large indexes inside a VHDX need explicit disk planning (the virtual disk grows with the index and does not shrink by itself; known WSL behaviour, not verified here).
- **Paths**: electrs defaults to `~/.bitcoin`; Fulcrum needs native backslashes; Bitcoin Core's Windows default data directory is `%LOCALAPPDATA%\Bitcoin` (or `%APPDATA%\Bitcoin` if it already exists). Always pass explicit paths and cookie locations.
- **Port collisions**: the 8000/8080 examples (Fulcrum admin/stats, ElectrumX LocalRPC 8000, mempool 8080/8999, BTC RPC Explorer 3002, Esplora 3000). Allocate dynamically and record the ports.
- **Node.js installs**: BTC RPC Explorer's `github:` dependencies may need git or network access at install time, and the missing lockfile means drift. Vendor the dependencies.

---

## 18. Security considerations

- **Address privacy**: an Electrum server or Esplora API learns every address it is asked about. Only self-hosted servers preserve privacy. Wallets must use `oneserver`-style configuration. Public servers and APIs are opt-in and labelled.
- **Unauthenticated control planes**: Fulcrum admin and `/stats`, ElectrumX LocalRPC, electrs Prometheus, BTC RPC Explorer by default, Blockbook WebSocket origins, mempool's UI and API. Loopback only, or behind authentication.
- **Bitcoin Core REST** (needed by electrs 0.12) is unauthenticated and shares the RPC listener. Never bind it beyond loopback or a host-only WSL subnet.
- **RPC credentials**: prefer the cookie (Fulcrum, electrs, BTC RPC Explorer, NBXplorer, mempool). Use dedicated rpcauth users for tools that need passwords (ElectrumX, containers, WSL2). If `rpcwhitelist` is used, remember that any whitelist turns other users into allow-nothing unless `rpcwhitelistdefault=0` (`full-nodes-core` notes §6.4).
- **Peer discovery and announcements** (Fulcrum, ElectrumX) leak the host's existence and IP; disable them for private servers.
- **TLS**: generate per-installation keys. Never ship shared keys (EPS's bundled certificate is the counter-example). Pin fingerprints in clients and keep the certificate stable.
- **Supply chain**:
  - Fulcrum: OpenPGP-signed checksums, pinned key.
  - electrs: no signed binaries, so BTCortex must build reproducibly in its own CI if it ships binaries.
  - ElectrumX: PyPI sdist plus a reproducible-build script.
  - Docker images (mempool, NBXplorer, Esplora): pin by digest. Image signatures were not researched.
  - BTC RPC Explorer: no lockfile.
- **Default secrets** in reference compose files (mempool) must be replaced with generated ones stored through the credential layer.
- **Licences**: Fulcrum (GPL-3.0-or-later), mempool and Blockbook (AGPL) carry source obligations if redistributed or modified and served. mempool's licence explicitly reserves trademarks.
- **No GitHub security advisories** were published for Fulcrum, electrs, ElectrumX, mempool, NBXplorer, Blockbook or BTC RPC Explorer as of 2026-10-21. ElectrumX fixed DoS and remote-crash issues in 1.19.0 and 1.16.0.

---

## 19. Open questions

1. Can BTCortex stop `Fulcrum.exe` gracefully on Windows during the initial sync (CTRL_C_EVENT via `AttachConsole`/`GenerateConsoleCtrlEvent`, or a hidden console)? Otherwise it must rely on crash safety.
2. How does Fulcrum's config parser handle Windows paths with spaces or non-ASCII characters?
3. Measure the current Fulcrum 2.1.x and electrs 0.12 mainnet index sizes and sync times on Windows-class hardware (an SSD desktop).
4. Feasibility of a BTCortex-built native Windows electrs (bindex and rust-rocksdb on MSVC, metrics feature off).
5. WSL2 and container networking design on Windows 10 for electrs and mempool: expose the native node's RPC/REST on the vEthernet adapter, or run a separate node inside WSL2? (Joint decision with `full-nodes-core` and `technology-platform`.)
6. Container runtime (Docker Desktop, an engine inside a BTCortex-managed WSL2 distribution, or Podman) and its licence terms; not researched here.
7. Records for generic dependencies `postgresql`, `mariadb` and `mongodb` (probably `technology-platform`).
8. Does OpenPGP.js verify Fulcrum's DSA-2048 checksum signatures?
9. Should BTC RPC Explorer be bundled at all, given low maintenance, or should BTCortex's native explorer cover the pruned-node case alone?
10. When will Sparrow and Electrum adopt protocol 1.7, and should BTCortex's own client implement it?
11. Exact NBXplorer health endpoint, and its behaviour when the node uses `bind=127.0.0.1` with `listen=1`.
12. Reach mempool.space from a non-VPN network to observe headers and limits; confirm Blockstream's free-tier numbers.
13. Behaviour of Fulcrum and other servers against a post-fork Knots node (expected: clients reject headers).
14. Whether `btc-rpc-proxy` belongs in this scope or in `developer-tools-libraries`.

---

## 20. Sources (all accessed 2026-10-21)

**Fulcrum**:
[Fulcrum 2.1.4 release](https://github.com/cculianu/Fulcrum/releases/tag/v2.1.4) ·
[GitHub API releases](https://api.github.com/repos/cculianu/Fulcrum/releases?per_page=4) ·
[releases feed](https://github.com/cculianu/Fulcrum/releases.atom) ·
[README](https://github.com/cculianu/Fulcrum/blob/master/README.md) ·
[example config](https://github.com/cculianu/Fulcrum/blob/master/doc/fulcrum-example-config.conf) ·
[man page](https://github.com/cculianu/Fulcrum/blob/master/doc/unix-man-page.md) ·
[Controller.cpp](https://github.com/cculianu/Fulcrum/blob/master/src/Controller.cpp) ·
[BitcoinD.cpp](https://github.com/cculianu/Fulcrum/blob/master/src/BitcoinD.cpp) ·
[App.cpp](https://github.com/cculianu/Fulcrum/blob/master/src/App.cpp) ·
[ServerMisc.h](https://github.com/cculianu/Fulcrum/blob/master/src/ServerMisc.h) ·
[SrvMgr.cpp](https://github.com/cculianu/Fulcrum/blob/master/src/SrvMgr.cpp) ·
[BTC.cpp](https://github.com/cculianu/Fulcrum/blob/master/src/BTC.cpp) ·
[SSLCertMonitor.h](https://github.com/cculianu/Fulcrum/blob/master/src/SSLCertMonitor.h) ·
[FulcrumAdmin](https://github.com/cculianu/Fulcrum/blob/master/FulcrumAdmin) ·
[Docker entrypoint](https://github.com/cculianu/Fulcrum/blob/master/contrib/docker/docker-entrypoint.sh) ·
[issue #304](https://github.com/cculianu/Fulcrum/issues/304) ·
[Docker Hub](https://hub.docker.com/r/cculianu/fulcrum) ·
[signing key](https://github.com/Electron-Cash/keys-n-hashes/blob/master/pubkeys/calinkey.txt) ·
[fulcrumserver.org](https://fulcrumserver.org/) ·
[Electrum Cash protocol changes](https://electrum-cash-protocol.readthedocs.io/en/latest/protocol-changes.html)

**electrs**:
[v0.12.0](https://github.com/romanz/electrs/releases/tag/v0.12.0) ·
[RELEASE-NOTES](https://github.com/romanz/electrs/blob/master/RELEASE-NOTES.md) ·
[README](https://github.com/romanz/electrs/blob/master/README.md) ·
[config.md](https://github.com/romanz/electrs/blob/master/doc/config.md) ·
[usage.md](https://github.com/romanz/electrs/blob/master/doc/usage.md) ·
[install.md](https://github.com/romanz/electrs/blob/master/doc/install.md) ·
[binaries.md](https://github.com/romanz/electrs/blob/master/doc/binaries.md) ·
[upgrading.md](https://github.com/romanz/electrs/blob/master/doc/upgrading.md) ·
[monitoring.md](https://github.com/romanz/electrs/blob/master/doc/monitoring.md) ·
[config_specification.toml](https://github.com/romanz/electrs/blob/master/internal/config_specification.toml) ·
[config.rs](https://github.com/romanz/electrs/blob/master/src/config.rs) ·
[electrum.rs](https://github.com/romanz/electrs/blob/master/src/electrum.rs) ·
[SECURITY.md](https://github.com/romanz/electrs/blob/master/SECURITY.md) ·
[Cargo.toml](https://github.com/romanz/electrs/blob/master/Cargo.toml) ·
[CI workflow](https://github.com/romanz/electrs/blob/master/.github/workflows/rust.yml) ·
[PR #1123](https://github.com/romanz/electrs/pull/1123) ·
[bindex-rs](https://github.com/romanz/bindex-rs) ·
[bindex client.rs](https://github.com/romanz/bindex-rs/blob/master/bindex-lib/src/client.rs) ·
[getumbrel/electrs](https://hub.docker.com/r/getumbrel/electrs) ·
[Umbrel manifest](https://github.com/getumbrel/umbrel-apps/blob/master/electrs/umbrel-app.yml) ·
[WSL networking](https://learn.microsoft.com/en-us/windows/wsl/networking)

**ElectrumX and the legacy personal servers**:
[ElectrumX 2.0.0](https://github.com/spesmilo/electrumx/releases/tag/2.0.0) ·
[README](https://github.com/spesmilo/electrumx/blob/master/README.md) ·
[documentation](https://electrumx-spesmilo.readthedocs.io/en/latest/) ·
[changelog](https://github.com/spesmilo/electrumx/blob/master/docs/changelog.rst) ·
[HOWTO](https://github.com/spesmilo/electrumx/blob/master/docs/HOWTO.rst) ·
[environment](https://github.com/spesmilo/electrumx/blob/master/docs/environment.rst) ·
[RPC interface](https://github.com/spesmilo/electrumx/blob/master/docs/rpc-interface.rst) ·
[daemon.py](https://github.com/spesmilo/electrumx/blob/master/src/electrumx/server/daemon.py) ·
[coins.py](https://github.com/spesmilo/electrumx/blob/master/src/electrumx/lib/coins.py) ·
[PyPI e-x](https://pypi.org/project/e-x/) ·
[lukechilds/electrumx](https://hub.docker.com/r/lukechilds/electrumx) ·
[kyuupichan/electrumx](https://github.com/kyuupichan/electrumx) ·
[EPS 0.2.4](https://github.com/chris-belcher/electrum-personal-server/releases/tag/eps-v0.2.4) ·
[EPS issue #309](https://github.com/chris-belcher/electrum-personal-server/issues/309) ·
[EPS PR #313](https://github.com/chris-belcher/electrum-personal-server/pull/313) ·
[bwt v0.2.4](https://github.com/bwt-dev/bwt/releases/tag/v0.2.4) ·
[bwt README](https://github.com/bwt-dev/bwt/blob/master/README.md) ·
[spesmilo/electrum-server](https://github.com/spesmilo/electrum-server) ·
[Bitcoin Core 30.0 release notes](https://bitcoincore.org/en/releases/30.0/)

**Explorers and their back ends**:
[Blockstream/electrs](https://github.com/Blockstream/electrs/blob/new-index/README.md) ·
[mempool/electrs v3.3.0](https://github.com/mempool/electrs/releases/tag/v3.3.0) ·
[Esplora v3.0.1](https://github.com/Blockstream/esplora/releases/tag/esplora_v3.0.1) ·
[Esplora README](https://github.com/Blockstream/esplora/blob/master/README.md) ·
[Esplora API](https://github.com/Blockstream/esplora/blob/master/API.md) ·
[run.sh](https://github.com/Blockstream/esplora/blob/master/run.sh) ·
[mempool v3.3.1](https://github.com/mempool/mempool/releases/tag/v3.3.1) ·
[mempool Docker README](https://github.com/mempool/mempool/blob/master/docker/README.md) ·
[mempool config sample](https://github.com/mempool/mempool/blob/master/backend/mempool-config.sample.json) ·
[mempool LICENSE](https://github.com/mempool/mempool/blob/master/LICENSE) ·
[BTC RPC Explorer v3.5.1](https://github.com/janoside/btc-rpc-explorer/releases/tag/v3.5.1) ·
[npm registry](https://registry.npmjs.org/btc-rpc-explorer) ·
[NBXplorer v2.6.19](https://github.com/btcpayserver/NBXplorer/releases/tag/v2.6.19) ·
[NBXplorer operator guide](https://github.com/btcpayserver/NBXplorer/blob/master/docs/Operator.md) ·
[Blockbook v0.6.0](https://github.com/trezor/blockbook/releases/tag/v0.6.0) ·
[Blockbook ports](https://github.com/trezor/blockbook/blob/master/docs/ports.md) ·
[ord 0.29.1](https://github.com/ordinals/ord/releases/tag/0.29.1) ·
[Bitcoin Research Kit](https://github.com/bitcoinresearchkit/mono) ·
[waterfalls](https://github.com/Blockstream/waterfalls/blob/master/README.md) ·
[Bitfeed](https://github.com/bitfeed-project/bitfeed/blob/master/README.md) ·
[Bitcore Node](https://github.com/bitpay/bitcore/blob/master/packages/bitcore-node/README.md) ·
[btc-rpc-proxy](https://github.com/Kixunil/btc-rpc-proxy/blob/master/README.md)

**Protocol, clients and public services**:
[Electrum protocol changes](https://github.com/spesmilo/electrum-protocol/blob/master/docs/protocol-changes.rst) ·
[protocol basics](https://github.com/spesmilo/electrum-protocol/blob/master/docs/protocol-basics.rst) ·
[protocol methods](https://github.com/spesmilo/electrum-protocol/blob/master/docs/protocol-methods.rst) ·
[Electrum RELEASE-NOTES](https://github.com/spesmilo/electrum/blob/master/RELEASE-NOTES) ·
[Electrum version.py](https://github.com/spesmilo/electrum/blob/master/electrum/version.py) ·
[Electrum interface.py](https://github.com/spesmilo/electrum/blob/master/electrum/interface.py) ·
[Electrum simple_config.py](https://github.com/spesmilo/electrum/blob/master/electrum/simple_config.py) ·
[Electrum blockchain.py](https://github.com/spesmilo/electrum/blob/master/electrum/blockchain.py) ·
[Sparrow ElectrumServer.java](https://github.com/sparrowwallet/sparrow/blob/master/src/main/java/com/sparrowwallet/sparrow/net/ElectrumServer.java) ·
[Sparrow TcpOverTlsTransport.java](https://github.com/sparrowwallet/sparrow/blob/master/src/main/java/com/sparrowwallet/sparrow/net/TcpOverTlsTransport.java) ·
[Sparrow server performance](https://www.sparrowwallet.com/docs/server-performance.html) ·
[mempool API docs component](https://github.com/mempool/mempool/blob/master/frontend/src/app/docs/api-docs/api-docs.component.html) ·
[Blockstream Explorer API blog](https://blog.blockstream.com/enhanced-analytics-and-infrastructure-improvements-for-the-blockstream-explorer-api/) ·
[Blockstream API keys help](https://help.blockstream.com/hc/en-us/articles/52415124540569-Create-and-manage-your-API-keys) ·
[Floresta README](https://github.com/getfloresta/Floresta) ·
[Frigate README](https://github.com/sparrowwallet/frigate/blob/master/README.md)
