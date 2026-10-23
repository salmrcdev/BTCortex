# Payments, sidechains and mining — research notes

Scope owner of `btcpay-server`, `cashu-nutshell`, `cdk-mintd`, `fedimint`, `elements`, `sideswap`, `aqua-wallet`, the Nostr Wallet Connect library `alby-js-sdk` (and the standard `nip-47`), `stratum-v2-reference-implementation`, `datum-gateway`, `public-pool`, `ckpool`, `braiins-os`, `bitaxe-axeos` and `cgminer`. All were researched on 2026-10-23. Records: [`../data/payments-sidechains-mining.json`](../data/payments-sidechains-mining.json) (15 entries) and [`../data/standards-payments-sidechains-mining.json`](../data/standards-payments-sidechains-mining.json) (NIP-47).

Projects owned by other scopes are referred to by canonical id only: `bitcoin-core`, `bitcoin-knots`, `nbxplorer`, `lnd`, `core-lightning`, `ldk-node`, `lnbits`, `alby-hub`, `zeus`, `peerswap`, `tor`.

## 1. BTCPay Server (`btcpay-server`, P2, `connected-application`)

- **Release and maintenance**: v2.4.5 on 2026-10-06; the repository was pushed on 2026-10-23 and is not archived. MIT licence.
- **Platforms** ([deployment guide](https://docs.btcpayserver.org/Deployment/)): Docker deployment (btcpayserver-docker, whose `btcpay-setup.sh` installs Docker and Docker Compose when needed), one-click hosting such as LunaNode, cloud and VPS providers (not OpenVZ), and hardware builds; manual installation and building without Docker are rated very hard and meant for development. Windows is not mentioned, so there is no native Windows installation, and BTCortex does not invent one (specification section 13).
- **Greenfield API v1** ([OpenAPI document](https://docs.btcpayserver.org/API/Greenfield/v1/swagger.json), read on 2026-10-23):
  - Authentication: `Authorization: token {key}`; HTTP Basic only where the user allows it. A key carries chosen permissions, never more than its user's, and can be limited to one store (`permission:storeId`).
  - `GET /api/v1/health` needs no key and answers `{synchronized}`.
  - `GET /api/v1/server/info` needs any key: `version`, `onion`, `supportedPaymentMethods`, `fullySynched`, `syncStatus[]` (`paymentMethodId`, `chainHeight`, `syncHeight`, `available`).
  - `GET /api/v1/stores` and `/api/v1/stores/{storeId}` need `btcpay.store.canviewstoresettings`.
  - `GET /api/v1/stores/{storeId}/invoices` needs `btcpay.store.canviewinvoices`, with `take`, `skip`, `status`, `startDate` and `endDate` (Unix seconds). Statuses: `New`, `Processing`, `Settled`, `Expired`, `Invalid`; additional statuses `None`, `PaidLate`, `PaidPartial`, `PaidOver`, `Marked`, `Invalid`. Amounts are decimal strings.
  - `GET /api/v1/stores/{storeId}/payment-methods` needs `btcpay.store.canviewstoresettings`; ids such as `BTC-CHAIN`, `BTC-LN`, `BTC-LNURL`.
  - `GET /api/v1/stores/{storeId}/payment-methods/{paymentMethodId}/wallet` needs `btcpay.store.canviewwallet`: `balance`, `confirmedBalance`, `unconfirmedBalance`.
  - `GET /api/v1/stores/{storeId}/lightning/{cryptoCode}/info` needs `btcpay.store.canuselightningnode`, which also lets a key use (and pay with) the store's Lightning node; BTCortex does not ask for it.
  - `GET /api/v1/api-keys/current` is documented with `btcpay.server.canmanageusers`, so the key's own permissions cannot be read with a read-only key; BTCortex finds out what it may read by trying.
  - `/api-keys/authorize?permissions=…&applicationName=…&strict=true` opens BTCPay's own form for creating a key with exactly those permissions.
  - Webhooks are signed in the `BTCPay-Sig` header as `sha256=HMAC256(secret, body)`.
- **Backups** ([backup and restore](https://docs.btcpayserver.org/Docker/backup-restore/)): `btcpay-backup.sh`, run as root on the host, stops the stack while it archives Docker volumes, generated secrets and database dumps (not blockchain data, caches, logs or LND's `data/graph`); `BTCPAY_BACKUP_PASSPHRASE` encrypts the archive. Old Lightning channel state is dangerous, and restoring the archive does not recover channels: keep `channel.backup`, the seed and passphrases separately, and recover channels with `restorechanbackup`.

## 2. How BTCortex integrates it

BTCortex connects to an existing installation (`apps/orchestrator/src/payments/`): the address is checked (HTTPS, or plain HTTP only on the local network or to an onion service through BTCortex's tor), the key is tested — health, server information, listing stores — before it is stored in the DPAPI vault, and the server is checked once a minute. The page reads each store's payment methods, on-chain balance and the invoices of the last 30 days, and says what the key may not read. Nothing is created, changed or paid. Deploying BTCPay Server would need Docker on Linux or WSL2, which BTCortex does not set up.

## 3. Ecash

| Entry | Latest | Windows | Licence | Notes |
|---|---|---|---|---|
| `cashu-nutshell` | 0.21.0 (PyPI, 2026-09-16) | Partial: Python package; the README gives Windows commands | MIT | Reference Cashu wallet and mint; mint on port 3338 in the Docker example (`cashubtc/nutshell:0.21.0`); Lightning back end set with `MINT_BACKEND_BOLT11_SAT` (LND, Core Lightning), FakeWallet for tests; Python 3.12 recommended (3.13 and 3.14 fail to build coincurve) |
| `cdk-mintd` | 0.18.2 (crates.io, 2026-10-14) | Unknown | MIT or Apache-2.0 | The Cashu Development Kit's mint, with back ends for LND, Core Lightning and LDK Node; "early development … works with real sats" |
| `fedimint` | 0.12.2 (2026-10-06); 0.13.0-beta.1 pre-release | No: Linux binaries, .deb and .rpm, macOS aarch64 | MIT | Federated modules (Bitcoin, Lightning, Chaumian ecash); `fedimintd` for guardians, `gatewayd` for Lightning gateways |

Ecash mints hold the bitcoin behind their tokens: a user trusts the mint (or the federation), and running one makes the operator custodian of other people's money. BTCortex records them and sets none up (`research-only`).

## 4. Liquid

- **Elements** 23.3.4 (2026-09-09): `elementsd -chain=liquidv1` runs a Liquid node.
  - Windows: `elements-23.3.4-win64.zip` and an unsigned setup program, covered by `SHA256SUMS` and its signatures.
  - Release candidates 23.4.0rc3 and 29.4.1rc1 are in testing.
  - A managed Liquid node would be possible on Windows, but BTCortex has no Liquid features to use it.
- **SideSwap** 1.9.2 (2026-09-23): non-custodial Liquid wallet and atomic-swap marketplace (L-BTC, USDt, EURx, AMP tokens; peg-in and peg-out), with `SideSwapSetup.exe` for Windows. GPL-3.0.
- **AQUA** 0.5.4 (2026-10-01): JAN3's open-source wallet for iOS and Android (MIT); its README says little more.

PeerSwap's README (see `peerswap`) mentions a Liquid incident: 7.0.1 turned off new L-BTC swaps, and L-BTC swaps need a back end on the post-ELIP 203 chain tip. What ELIP 203 changed was not examined.

## 5. Nostr Wallet Connect

- **NIP-47** (draft, optional) lets applications use a Lightning wallet through Nostr relays.
  - Connection: a `nostr+walletconnect://` connection string.
  - Events: kinds 13194 (info), 23194 (request) and 23195 (response).
  - Encryption: NIP-44 (NIP-04 only for backward compatibility).
  - Methods: `pay_invoice`, `make_invoice`, `lookup_invoice`, `get_balance`, `get_info`; extensions define more.
- **Implementations**: Alby Hub (see `alby-hub`) is the main wallet service; ZEUS acts as service and client; `@getalby/sdk` 8.1.1 (2026-10-21, MIT) is the JavaScript library.
- **BTCortex** does not offer NWC. Its connection string is a secret that lets the holder spend within the granted permissions.

## 6. Mining

| Entry | Latest | Windows | Licence | Node | Notes |
|---|---|---|---|---|---|
| `stratum-v2-reference-implementation` | sv2-apps 0.8.0 and stratum 1.12.0 (2026-09-17) | No (Linux musl and macOS archives) | MIT or Apache-2.0 | Bitcoin Core's IPC interface, which its Windows builds lack | Pool, job declarator server and client, translator proxy; alpha |
| `datum-gateway` | 0.5.1beta (2026-10-19) | No (Debian packages, source, Docker) | MIT | Bitcoin Core recommended; **Knots after 29.3.knots20260507 no longer compatible** | OCEAN's gateway for miner-built templates; Stratum v1 to hardware; public beta |
| `public-pool` | no releases | Unknown (Docker from source) | not stated | RPC (Docker needs `rpcallowip=172.16.0.0/12`) | NestJS Stratum server on ports 3333 and 3334 |
| `ckpool` | no releases (Bitbucket, updated 2026-10-14) | No (Linux) | GPL-3.0 | bitcoind with `server`, `rpcuser`, `rpcpassword`; optional ZMQ | Pool, proxy, passthrough, node, redirector and BTCSOLO modes; asks to keep a 0.5% development contribution |
| `braiins-os` | not examined | n/a (ASIC firmware) | proprietary, with a 2–2.5% development fee | — | Antminer firmware with autotuning, Stratum V2 and gRPC APIs; Braiins Toolbox |
| `bitaxe-axeos` | 2.15.4 (2026-10-21) | n/a (ESP32 firmware) | GPL-3.0 | — | AxeOS web interface and REST API (`/api/system/info`, `PATCH /api/system`) on the local network, apparently without authentication |
| `cgminer` | 4.11.1 (2018-08-16) | Unknown | GPL-3.0 | — | Stale |

Findings:

- **DATUM and Knots.**
  - Knots' release notes direct miners on its chain to run DATUM, yet DATUM's README says Knots releases after 29.3.knots20260507 no longer work with it. Those are the releases that follow another chain; see `bitcoin-knots`.
  - The `bitcoin-knots` record was corrected accordingly.
  - The `datum-gateway` record marks Knots as conflicting.
- **Stratum V2 needs a different set-up.**
  - SRI's template provider path uses Bitcoin Core's IPC mining interface.
  - Bitcoin Core does not build that interface for Windows.
  - So a Windows node managed by BTCortex cannot serve SRI. Its feasibility is `none`.
- **A Bitaxe could be shown on BTCortex's dashboards.**
  - Its local REST API would allow it.
  - Mining is outside BTCortex's features today, so it stays `research-only`.

## 7. Open questions

- Whether btcpayserver-docker runs under WSL2 or Docker Desktop on Windows is not documented and was not tried.
- No real BTCPay Server was available on this computer, so the client is tested against a stand-in that answers with the documented shapes.
- DATUM Gateway's INSTALL.md (Stratum port, node settings) and the Stratum V2 applications' configuration were not read.
- Who signs Elements' and SideSwap's checksums was not identified.
