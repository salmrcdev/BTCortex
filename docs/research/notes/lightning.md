# Lightning implementations, management tools and liquidity services: technical reference (scope `lightning`)

Verified on **2026-10-23**. Records: [`../data/lightning.json`](../data/lightning.json) (24 entries; the last ten, from LDK to chantools, were added on the same day and are summarised in section 9).

Every statement below was checked against a primary source fetched on the verification date: GitHub releases (REST API), README files and documentation in the repositories, source code at the release tag (LND), and licence files. LND was also installed and run: three LND 0.21.4-beta nodes on a regtest Bitcoin Core 31.1 on Windows 10 22H2, with channels, a routed payment and the REST answers recorded. Where something could not be verified it says so; such claims are also listed in the `unverifiedClaims` of each record.

Projects owned by other scopes are referred to by canonical id only: `bitcoin-core`, `tor`.

---

## 0. Key facts at a glance

| Entry | Latest stable (date) | Native Windows | Interface BTCortex would use | Recommended level | Priority |
|---|---|---|---|---|---|
| `lnd` | 0.21.4-beta (2026-10-01) | **Yes**: x64, x86 and arm64 ZIPs | REST + macaroon, pinned certificate | `connected-application` | **P0** |
| `core-lightning` | 26.06.9 (2026-10-07) | **No** (Ubuntu and Fedora binaries) | clnrest (HTTPS) + rune | `remote-managed` | P1 |
| `eclair` | 0.14.5 (2026-10-20) | Unknown (JVM, Java 21) | HTTP API + password | `research-only` | P2 |
| `ldk-node` | 0.7.0 (2025-12-03) | n/a (library) | — | `research-only` | P3 |
| `phoenixd` | 0.9.3 (2026-10-13) | No (WSL per README; JVM build) | HTTP API + password | `research-only` | P3 |
| `ride-the-lightning` | 0.15.15 (2026-10-21) | Partial (Node.js from source) | — (web interface) | `research-only` | P3 |
| `thunderhub` | 0.19.1 (2026-10-22) | Unknown (source only) | — | `research-only` | P3 |
| `lnbits` | 1.6.2 (2026-09-18) | Unknown (Linux AppImage) | — | `research-only` | P3 |
| `lndg` | 1.11.1 (2026-09-27) | Unknown (Docker Compose, Python) | — | `research-only` | P3 |
| `lightning-terminal` | 0.17.8 (2026-10-22) | **Yes**: x64 ZIP | — | `research-only` | P2 |
| `lightning-loop` | 0.35.2-beta (2026-10-22) | **Yes**: x64 ZIP | — | `research-only` | P3 |
| `lightning-pool` | 0.7.0-beta (2026-05-20) | Unknown (no assets) | — | `research-only` | P3 |
| `boltz-client` | 2.12.5 (2026-07-15) | No (Linux only) | — | `research-only` | P3 |
| `alby-hub` | 1.24.4 (2026-10-22) | **Yes**: desktop ZIP | — | `research-only` | P3 |
| `ldk` | 0.2.7 (2026-10-02, crates.io) | n/a (library) | — | `research-only` | P3 |
| `faraday` | 0.2.14-alpha (2025-01-21) | **Yes**: x64 and x86 ZIPs | — | `research-only` | P3 |
| `boltz` | backend 3.13.0 (2026-05-08) | n/a (hosted service) | — | `research-only` | P3 |
| `peerswap` | 7.0.2 (2026-10-15) | Unknown (source only) | — | `research-only` | P3 |
| `balance-of-satoshis` | 25.3.1 (2026-10-17) | Unknown (npm, Node.js 22+) | — | `research-only` | P3 |
| `teos` | 0.2.0 (2023-02-07), stale | Unknown (source only) | — | `research-only` | P3 |
| `breez-sdk` | Spark SDK 0.27.2 (2026-10-23) | n/a (library) | — | `research-only` | P3 |
| `greenlight` | — (hosted service) | n/a | — | `research-only` | P3 |
| `zeus` | 13.2.3 (2026-10-12) | No (Android and iOS) | an lndconnect address (not built) | `research-only` | P2 |
| `chantools` | 0.14.3 (2026-09-29) | **Yes**: x64 ZIP | — | `research-only` | P3 |

Implementations (`lnd`, `core-lightning`, `eclair`, `phoenixd`) run nodes; `ldk-node` is a library; RTL, ThunderHub, LNbits, LNDg, Lightning Terminal and Alby Hub are management interfaces or wallets on top of a node; Loop, Pool and Boltz move liquidity through a service.

---

## 1. Decision

LND is the Lightning implementation with official Windows builds, documented REST and gRPC interfaces, and macaroons that can be limited to reading. BTCortex connects to it first, as a connected application: it reads with the read-only macaroon and never moves funds (specification section 11.3, "Never automatically move funds"). Core Lightning has no Windows build, so it can only be reached on another computer, through clnrest. Managing an LND for the user (installing, configuring and running it) is technically possible, because the installer is verified (section 2.1), but creating its wallet shows the seed, which BTCortex must leave to LND's own tools.

---

## 2. LND

### 2.1 Releases and verification

- Two maintained lines: v0.21.4-beta and v0.20.5-beta, both on 2026-10-01; release candidates v0.21.5-beta.rc1 and v0.20.6-beta.rc1 on 2026-10-22.
- Windows assets: `lnd-windows-amd64-v0.21.4-beta.zip` (49 391 174 bytes), `lnd-windows-386-…` and `lnd-windows-arm64-…`, each with `lnd.exe` and `lncli.exe` in a folder of the archive's name. Neither executable carries an Authenticode signature (checked on the installed files).
- `manifest-v0.21.4-beta.txt` lists the SHA-256 of every asset. Each release signer signs it in a separate **binary** OpenPGP file, `manifest-<user>-v0.21.4-beta.sig`; OpenTimestamps proofs (`.ots`) accompany some.
- LND's own `scripts/verify-install.sh` at the tag lists 16 keys (fingerprint and user name) and requires `MIN_REQUIRED_SIGNATURES=5`, each from a different user, with one keyring per user so that a user cannot reach the threshold with several files. The keys are in `scripts/keys/<user>.asc`.
- v0.21.4-beta carried 8 valid signatures on 2026-10-23: bhandras, boris, georgetsagk, gijswijs, roasbeef, suheb, ViktorT-11 and ziggie1984. Of the 16 listed keys, one (ellemouton) expired on 2026-06-21.
- The binaries are reproducible with go1.27.1 (`make release`).

BTCortex mirrors the script: it pins the 16 keys from `verify-install.sh` and `scripts/keys` at the tag, requires 5 distinct valid signers, then checks the ZIP's hash, extracts it and requires `lnd --version` to report the version before the installation is used.

### 2.2 On Windows

- LND's folder is `btcutil.AppDataDir("lnd", false)`: `%LOCALAPPDATA%\Lnd` (falling back to `%APPDATA%`), with `lnd.conf`, `tls.cert`, `tls.key`, `logs\` and `data\`. Macaroons are in `data\chain\bitcoin\<network>\` (`admin.macaroon`, `readonly.macaroon`, `invoice.macaroon`), next to `wallet.db` and `channel.backup`.
- Default ports: 9735 (peers), 10009 (gRPC, localhost), 8080 (REST, localhost).
- Exactly one of `bitcoin.mainnet`, `bitcoin.testnet`, `bitcoin.testnet4`, `bitcoin.signet`, `bitcoin.regtest` or `bitcoin.simnet` must be set; without one, LND refuses to start.
- `lnd.conf` is an INI file whose keys carry their own namespace (`bitcoin.mainnet=true` under `[Bitcoin]`), so a reader can ignore the sections. Path options (`datadir`, `tlscertpath`, `adminmacaroonpath`, `readonlymacaroonpath`, `invoicemacaroonpath`) expand `~` and environment variables.
- Options use go-flags: `lnd --help` on Windows prints the `/option:value` form, `--option=value` also works, and a switch takes no value on the command line (`--noseedbackup=true` is refused; `noseedbackup=true` in `lnd.conf` is accepted).
- `tlsautorefresh` re-creates the certificate when the computer's addresses change; deleting `tls.cert` makes LND create a new one. Either breaks a client that pinned the old certificate.

### 2.3 REST and macaroons

- The REST interface is grpc-gateway over HTTPS with LND's self-signed certificate. 64-bit integers are JSON strings, bytes are base64 (transaction ids in internal byte order), names are snake_case, and default values are present.
- Authentication: the macaroon, hex-encoded, in the `Grpc-Metadata-macaroon` header. `/v1/state` answers without one (`NON_EXISTING`, `LOCKED`, `UNLOCKED`, `RPC_ACTIVE`, `SERVER_ACTIVE`, `WAITING_TO_START`).
- Errors are `{"code", "message", "details"}` with HTTP 500 for most failures. Recorded on 0.21.4: no macaroon gives "expected 1 macaroon, got 0"; another node's macaroon gives "verification failed: signature mismatch after caveat verification"; the read-only macaroon on `POST /v1/invoices` gives "permission denied"; `/v2/watchtower/client` without the watchtower client gives "watchtower client not active".
- Routes BTCortex reads (all allowed by `readonly.macaroon`): `/v1/getinfo`, `/v1/balance/blockchain`, `/v1/balance/channels`, `/v1/channels` (with `peer_alias_lookup=true` for peer aliases), `/v1/channels/pending`, `/v1/peers`, `/v1/fees` (fees earned over a day, week and month, and per-channel policies), `POST /v1/switch` (forwarding history from `start_time`, at most `num_max_events`), `/v1/invoices` (`reversed=true` for the newest), `/v1/payments` (`include_incomplete=true`), `/v1/graph/info`, `/v2/watchtower/client` and `/v1/channels/backup` (the static channel backup, encrypted with a key from the seed).
- Some answers hold secrets: payments include `payment_preimage`, invoices `r_preimage` and `payment_addr`. They must not leave the component that talks to LND.
- Streaming calls (for example `POST /v2/router/send`) answer with newline-delimited JSON objects, `{"result": …}` or `{"error": …}`.
- A macaroon is a version 2 binary macaroon whose identifier is a version byte (3) followed by the protobuf `MacaroonId { nonce = 1; storageId = 2; repeated Op ops = 3 }`, `Op { entity = 1; repeated actions = 2 }`. The permissions can therefore be read without asking the node. `readonly.macaroon` has only `read` actions; `invoice.macaroon` writes only `invoices` and `address`; `admin.macaroon` writes `offchain` and `onchain`, among others. First-party caveats such as `time-before <RFC 3339>` narrow a macaroon further.
- lndconnect URIs (`lndconnect://<host>:<port>?[cert=<base64url DER certificate>&]macaroon=<base64url macaroon>`) are what node packages show for wallets. The specification's examples use the gRPC port 10009, so a REST client must not take the port for granted.

### 2.4 Testing on Windows

With `bitcoind.rpcpolling` (no ZMQ needed) and `bitcoind.rpccookie`, three LND 0.21.4 nodes on regtest reached `synced_to_chain` in about 5 s each. Channels became active right after 6 blocks; routing from alice to carol through bob needed both channel policies to arrive by gossip first (with `trickledelay=50`, a second or two), which `/v1/graph/routes/<pubkey>/<amount>` shows. The forwarding fee was 1 sat 25 msat on a 25 000 sat payment with LND's default policy (1000 msat base, 1 ppm).

---

## 3. Core Lightning

- v26.06.9 (2026-10-07). Release binaries for Ubuntu 22.04, 24.04 and 26.04 (amd64, arm64, armv7) and Fedora 40, with signed SHA256SUMS; Docker image `elementsproject/lightningd`; build instructions for Ubuntu, Fedora, NixOS and macOS. The installation guide does not mention Windows.
- `clnrest` serves every RPC method as `POST /v1/<method>` over HTTPS (default host 127.0.0.1; the plugin is off unless `clnrest-port` is set, 3010 being common), authenticated by a rune in the `Rune` header; read-only runes suffice for reading. Its certificates default to the gRPC plugin's.
- Licence: BSD-MIT, except the `ccan/` modules.

BTCortex can reach a Core Lightning node only remotely (clnrest), or through WSL2 or Docker. Not implemented; there is no Windows test environment for it.

## 4. Eclair

- v0.14.5 (2026-10-20), a JVM distribution (`eclair-node-…-bin.zip`) with `SHA256SUMS.asc`. It targets Java 21.
- It needs Bitcoin Core 31 or later, synchronised, with ZMQ, its wallet enabled, `txindex` and no pruning: channel funding and closing go through Bitcoin Core's wallet.
- HTTP API on `eclair.api.port` (8080), off by default, with HTTP Basic authentication by `eclair.api.password`; it must not be reachable from outside.

## 5. LDK and LDK Node

LDK Node 0.7.0 (2025-12-03) is a Rust library (with bindings) for embedding a node in an application, licensed MIT or Apache-2.0. Nothing to install or connect to; applications built on it (Alby Hub) are covered separately.

## 6. phoenixd

v0.9.3 (2026-10-13). Native builds for Linux and macOS and a JVM build; the README says it runs on Windows through WSL. It does not use the user's node and relies on ACINQ for liquidity.

## 7. Management interfaces and wallets

- **Ride The Lightning** 0.15.15 (2026-10-21): web interface for LND, Core Lightning and Eclair; Node.js 22.23.4+ or 24.22.1+, installed from source with `npm ci`; port 3000 in the sample configuration; uses `admin.macaroon`.
- **ThunderHub** 0.19.1 (2026-10-22): LND web interface, source only; documentation moved to docs.thunderhub.io.
- **LNbits** 1.6.2 (2026-09-18): Python server with isolated wallets on top of a funding source; the release ships a Linux AppImage.
- **LNDg** 1.11.1 (2026-09-27): LND analysis and automation (rebalancing, fees) with Docker Compose; talks to gRPC on 127.0.0.1:10009.
- **Lightning Terminal** 0.17.8 (2026-10-22): Loop, Pool, Faraday and Taproot Assets with a web interface, against a remote or integrated LND; Windows x64 ZIP, manifest signed by roasbeef.
- **Alby Hub** 1.24.4 (2026-10-22): wallet and node manager with Nostr Wallet Connect, its own LDK node or an existing one such as LND; Windows desktop ZIP.

## 8. Liquidity services

- **Loop** 0.35.2-beta (2026-10-22): submarine swaps through Lightning Labs' server; Windows x64 ZIP; gRPC 11010 and REST 8081 with Loop's own macaroons; needs LND with all sub-servers.
- **Pool** 0.7.0-beta (2026-05-20): channel-lease auctions; the release has no binaries; needs LND 0.19.0-beta or later.
- **Boltz Client** 2.12.5 (2026-07-15): automated swaps for LND or Core Lightning; Linux binaries only.

All three move funds through a service and are outside what BTCortex does until it has an explicit, user-defined policy for that.

## 9. Further tools, watchtowers, rescue tools, SDKs and hosted nodes

- **LDK** (the `lightning` crate) 0.2.7 (2026-10-02): the Rust library LDK Node is built on; the crate's repository field points to git.rust-bitcoin.org, and the GitHub repository lists no releases. ZEUS 13.2.3 ships rust-lightning 0.2.7 for its security fixes.
- **Faraday**: Lightning Labs' reports for LND (node audit, close reports) on gRPC `localhost:8465` with its own macaroons. It needs LND 0.11.1 or later with all sub-servers and LND's admin macaroon (or a custom one). Close reports need a node with `txindex`. The last release with binaries (including Windows x64 and x86) is v0.2.14-alpha; later tags up to v0.2.19-alpha have no release, and Faraday ships inside Lightning Terminal.
- **Boltz**: the non-custodial swap service whose backend (AGPL-3.0) is open source; boltz.exchange, its documentation and its API could not be resolved from this network, so fees and limits were not read. Boltz Client is section 8.
- **PeerSwap** 7.0.2 (2026-10-15): swaps with channel peers, on chain or in L-BTC, as a Core Lightning plugin or beside LND.
  - Beta-grade: the README recommends small balances or test networks.
  - 7.0.2 fixes security issues in claim-payment deadlines and cooperative refunds.
  - 7.0.1 turned off new L-BTC swaps after a Liquid incident; L-BTC needs an Elements or LWK back end on the post-ELIP 203 chain tip.
- **Balance of Satoshis** 25.3.1 (2026-10-17): the `bos` command-line tool for LND (accounting, rebalancing, fees, opening channels, a Telegram bot).
  - It supports LND 0.20.0–0.20.5 and 0.21.0–0.21.4.
  - It uses LND's admin macaroon by default.
  - Its npm `engines` field asks for Node.js 22 or later, while its README says Node 20+.
- **The Eye of Satoshi** (`teos`): a BOLT 13 watchtower whose client is a Core Lightning plugin. Its latest release is v0.2.0 from 2023-02-07 and its last push was on 2025-10-09, so the entry is marked stale. LND has a watchtower of its own (see `lnd`).
- **Breez SDK**: sdk-doc.breez.technology now redirects to the Spark SDK (0.27.2, 2026-10-23).
  - It is nodeless and non-custodial, and its documentation describes a unilateral exit to the chain.
  - Bindings: Kotlin, Swift, JavaScript, React Native, Flutter, Go, Python, C# and WebAssembly.
  - It needs a free API key from Breez.
- **Greenlight**: Blockstream's hosted, non-custodial Core Lightning nodes for application developers. The seed stays on the user's device. Applications register nodes with a developer certificate from the Greenlight Developer Console and reach them over gRPC with mutual TLS.
- **ZEUS** 13.2.3 (2026-10-12): an Android and iOS wallet and remote manager.
  - It connects to LND and Core Lightning (also over Tor and Lightning Node Connect), and to LNDHub and Nostr Wallet Connect.
  - It can also run an embedded LND 0.21.4 or LDK Node.
  - Licence: AGPL-3.0, except some commercial fonts.
  - BTCortex could hand it a limited LND connection as a QR code; not built.
- **chantools** 0.14.3 (2026-09-29): rescue tool for LND channels (zombie channels, remote force closes), with a Windows x64 ZIP and a signed manifest.
  - Many commands need the seed, which BTCortex never handles, so it is recorded for reference only.
  - Some commands query public block explorers unless `--apiurl` points at the user's own.

## 10. Licences

MIT: LND, Ride The Lightning, ThunderHub, LNbits, LNDg, Lightning Terminal, Loop, Pool, Boltz Client, Faraday, PeerSwap, Balance of Satoshis, teos, Breez SDK (Spark), Greenlight's client libraries, chantools. Apache-2.0: Eclair, phoenixd, Alby Hub. BSD-MIT: Core Lightning. MIT or Apache-2.0: LDK Node, LDK. AGPL-3.0: the Boltz backend, ZEUS.

## 11. Open questions

- Mainnet resource use of LND on Windows (memory, disk, start-up) was not measured.
- Whether BTCortex should manage an LND (and how to hand wallet creation to LND's own tools) needs a design that never routes the seed through BTCortex.
- Core Lightning's clnrest has not been tested against a real node.
- Boltz's public API (fees, limits, onion address) could not be read on 2026-10-23, because its domains did not resolve from this network.
