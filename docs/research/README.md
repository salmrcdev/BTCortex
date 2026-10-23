# BTCortex ecosystem research

This directory holds the Phase 1 research for BTCortex (specification sections 1, 36, 37 and 39). The JSON records are the **single source of truth**:

- `docs/ECOSYSTEM_RESEARCH.md`, `docs/INTEGRATION_MATRIX.md` and `docs/DEPENDENCY_MATRIX.md` are generated from them.
- The in-app Bitcoin Ecosystem Catalogue is seeded from the same records, so every claim must be accurate, sourced and dated.

## Layout

| Path | Content |
|---|---|
| `data/<scope>.json` | Array of **ecosystem entries** for one research scope |
| `data/standards-<scope>.json` | Array of **standards entries** (BIPs, BOLTs, NIPs, specifications) |
| `tech-stack/<scope>.json` | Array of **package entries** for the application's own technology stack |
| `notes/<scope>.md` | Narrative notes for the scope: landscape, integration details, pitfalls, open questions |

Validate from the repository root:

```bash
node scripts/research/validate.mjs                          # every file, including cross-file checks
node scripts/research/validate.mjs docs/research/data/x.json  # specific files only
```

## Research rules

1. **Primary sources first**: official websites, official repositories (README, releases, changelogs), official documentation, security advisories. Secondary sources may support but never replace them.
2. **Verify live.** Training knowledge goes stale. Releases, maintenance status and platform support must come from pages fetched on the verification date.
3. **Never fabricate.** If something could not be verified, write `unknown` (or `null` where allowed) and list the claim in `unverifiedClaims`.
4. **Be precise about Windows.** Distinguish official native Windows binaries, build-from-source-only, WSL2-only, Docker-only and no Windows support at all.
5. **Flag** discontinued, superseded, abandoned, security-compromised or legally problematic projects explicitly.
6. **British English** for all prose (colour, behaviour, organise, licence as a noun). Official names, protocol fields, configuration keys and API methods keep their upstream spelling.

## Ecosystem entry (`data/<scope>.json`)

Every field is required. Use `null` only where the type says so.

| Field | Type | Meaning |
|---|---|---|
| `id` | kebab-case string | Globally unique. Use the canonical ids below for well-known projects. |
| `name` | string | Official project name. |
| `category` | enum | See *Categories*. |
| `catalogueEligible` | boolean | Whether the entry belongs in the in-app catalogue. Libraries, standards-only items and hosted custodial services are usually `false`. |
| `website` | URL \| null | Official website. |
| `repository` | URL \| null | Official source repository. `null` for closed-source software. |
| `purpose` | string | One or two sentences. |
| `maintenance` | object | `{ status, evidence, supersededBy }`. `status` ∈ `active`, `maintenance-only`, `stale`, `discontinued`, `superseded`, `unknown`. `evidence` cites dates (latest release, latest commit). `supersededBy` is a string or `null`. |
| `latestStableRelease` | object \| null | `{ version, date, source }`. `date` is `YYYY-MM-DD` (or `YYYY-MM`) or `null`. `source` is the release page URL. |
| `verifiedOn` | date | Day the entry was verified, `YYYY-MM-DD`. |
| `platforms` | object | `{ windowsNative, windowsVersions, windowsArchitectures, windowsDistribution, wsl2, docker, other }`. See below. |
| `interfaces` | array | `{ type, description, authentication, documentation }` per API or CLI surface. `type` ∈ `json-rpc`, `rest`, `http`, `grpc`, `websocket`, `zmq`, `electrum-protocol`, `p2p`, `cli`, `gui`, `control-protocol`, `socks`, `unix-socket`, `named-pipe`, `ssh`, `file`, `qr`, `usb`, `nfc`, `library-api`, `other`. `authentication` and `documentation` may be `null`. |
| `cli` | string \| null | Command-line tools and notable flags. |
| `remoteManagement` | string \| null | How the software can be managed remotely (APIs, SSH, admin interfaces). |
| `nodeCompatibility` | string \| null | Compatibility with Bitcoin Core, Knots or other backends, including required node settings (for example `txindex`, ZMQ, `server=1`). |
| `dependencies` | array | `{ ids, relationship, notes }`. `ids` lists entry ids; several ids mean *any one of these*. `relationship` ∈ `requires`, `optional`, `enhances`, `conflicts`. |
| `networking` | string \| null | Default ports, protocols, binding behaviour and inbound/outbound requirements. |
| `storage` | string \| null | Disk requirements with dates (for example, the mainnet index size as of a given date). |
| `resources` | string \| null | RAM and CPU requirements. |
| `security` | string | Security implications for operators and for BTCortex. |
| `licence` | string \| null | SPDX identifier where possible. |
| `licenceNotes` | string \| null | Redistribution or trademark constraints that matter to BTCortex. |
| `integrationMechanisms` | string[] | Concrete ways BTCortex can integrate (generate a config file, manage a process, call an API, launch the executable, and so on). |
| `supportLevels` | enum[] | Every *feasible* support level, most preferred first. |
| `recommendedSupportLevel` | enum | Must appear in `supportLevels`. |
| `feasibility` | object | `{ rating, notes }`. `rating` ∈ `high`, `medium`, `low`, `none`. |
| `priority` | enum | `P0` the Bitcoin Core vertical slice, `P1` essential integrations (spec Phase 5), `P2` Lightning, payments and advanced features (Phases 6–7), `P3` optional or later. |
| `implementationStatus` | enum | Always `researched` during Phase 1. |
| `notes` | string \| null | Anything else that matters. |
| `sources` | array | Non-empty. `{ title, url, accessed }`, with `accessed` as `YYYY-MM-DD`. |
| `unverifiedClaims` | string[] | Claims that could not be verified live. Empty only if everything was verified. |

### `platforms`

| Field | Allowed values |
|---|---|
| `windowsNative` | `yes` (official Windows binaries), `partial` (works with caveats or is build-from-source only), `no`, `unknown`, `not-applicable` (hardware, hosted service, specification) |
| `windowsVersions` | string or `null`, for example `Windows 10 and later` |
| `windowsArchitectures` | array of `x64`, `arm64`, `x86`; empty when not native |
| `windowsDistribution` | string or `null`, for example `NSIS installer and portable ZIP` |
| `wsl2` | `yes`, `likely` (Linux build that should run under WSL2 but is not documented as such), `no`, `unknown`, `not-applicable` |
| `docker` | `official-image`, `community-image`, `compose-only`, `no`, `unknown`, `not-applicable` |
| `other` | string or `null`: other supported operating systems or platforms |

### Support levels (specification section 6)

| Value | Meaning |
|---|---|
| `fully-managed` | Native Windows installation and full lifecycle management |
| `managed-wsl2` | Installed and managed inside a WSL2 distribution |
| `managed-docker` | Installed and managed as Docker containers |
| `remote-managed` | Managed on another machine through a supported API or SSH |
| `connected-application` | BTCortex manages configuration and connections, not the lifecycle |
| `external-launcher` | Safe discovery and launching only |
| `research-only` | Integration not yet verified or designed |
| `unsupported` | Verified incompatibility or unacceptable security issue |

### Categories

`full-node`, `node-platform`, `electrum-server`, `indexer`, `block-explorer`, `data-service`, `desktop-wallet`, `mobile-wallet`, `multisig-coordinator`, `hardware-wallet`, `signing-tool`, `lightning-implementation`, `lightning-management`, `lightning-liquidity`, `lightning-infrastructure`, `privacy-network`, `private-network`, `remote-access`, `reverse-proxy`, `transaction-privacy`, `payment-processor`, `payment-tool`, `ecash`, `sidechain`, `nostr`, `mining`, `monitoring`, `developer-tool`, `test-network`, `library`, `backup-tool`, `security-tool`, `other`.

## Standards entry (`data/standards-<scope>.json`)

| Field | Type | Meaning |
|---|---|---|
| `id` | kebab-case string | For example `bip-0324`, `bolt-12`, `nip-47`, `electrum-protocol`. Globally unique. |
| `kind` | enum | `BIP`, `BOLT`, `BLIP`, `NIP`, `SLIP`, `LUD`, `BCR`, `specification`, `other` |
| `number` | string \| null | For example `324` |
| `title` | string | Official title |
| `status` | string | Status as published upstream (for example `Final`, `Draft`, `Deployed`) |
| `summary` | string | What it specifies |
| `relevance` | string | Why it matters to BTCortex and which feature uses it |
| `implementedIn` | string[] | Entry ids, with versions where known (for example `bitcoin-core >= 27.0 (default on)`) |
| `sources` | array | As for ecosystem entries |

## Package entry (`tech-stack/<scope>.json`)

| Field | Type | Meaning |
|---|---|---|
| `name` | string | Package or tool name, for example `@tauri-apps/cli` or `tauri-plugin-shell` |
| `ecosystem` | enum | `npm`, `crates.io`, `github`, `system`, `nuget`, `other` |
| `latestVersion` | string \| null | Latest stable version verified live |
| `releaseDate` | date \| null | Release date of that version |
| `licence` | string \| null | SPDX identifier |
| `purpose` | string | What BTCortex would use it for |
| `decision` | enum | `adopt`, `adopt-conditional`, `consider`, `reject` |
| `rationale` | string | Why, including alternatives considered |
| `windowsNotes` | string \| null | Windows-specific caveats (native addons, prebuilt binaries, ARM64, WebView2) |
| `sources` | array | As above |
| `unverifiedClaims` | string[] | As above |

## Canonical ids and scope ownership

Each project is recorded **once**, by the scope that owns it. Other scopes refer to it by id in `dependencies` and in their notes. If you find a project not listed here, add it to the scope that fits best, using a descriptive kebab-case id.

| Scope (file slug) | Owns |
|---|---|
| `full-nodes-core` | `bitcoin-core`, `bitcoin-knots` |
| `full-nodes-alternatives-platforms` | `btcd`, `floresta`, `utreexod`, `libbitcoin`, `bcoin`, `gocoin`, other full-node implementations; node platforms `umbrel`, `start9`, `mynode`, `raspiblitz`, `nix-bitcoin`, `raspibolt`, `minibolt`, `parmanode` and others; monitoring tools such as `prometheus`, `grafana`, `bitcoin-prometheus-exporter`, `peer-observer`, `fork-observer` |
| `electrum-indexers-explorers` | `fulcrum`, `electrs`, `electrumx`, `electrum-personal-server`, `blockstream-electrs`, `mempool-electrs`, `esplora`, `mempool`, `btc-rpc-explorer`, `nbxplorer`, `blockbook`, public data services such as `mempool-space-api` and `blockstream-info-api` |
| `wallets-hardware` | `sparrow`, `electrum`, `specter-desktop`, `liana`, `nunchuk`, `caravan`, `wasabi-wallet`, `bitcoin-safe`, `bitcoin-keeper`, `blockstream-app`, `trezor-suite`, `ledger-live`, `bitboxapp`, `hwi`, `coldcard`, `trezor`, `ledger`, `bitbox02`, `jade`, `passport`, `keystone`, `seedsigner`, `krux`, `specter-diy`, `tapsigner` |
| `lightning` | `lnd`, `core-lightning`, `eclair`, `ldk`, `ldk-node`, `phoenixd`, `alby-hub`, `ride-the-lightning`, `thunderhub`, `lnbits`, `lndg`, `lightning-terminal`, `lightning-loop`, `lightning-pool`, `faraday`, `boltz`, `boltz-client`, `peerswap`, `balance-of-satoshis`, `teos`, `breez-sdk`, `greenlight`, `zeus`, `chantools` |
| `privacy-networking` | `tor`, `arti`, `tor-browser`, `i2p`, `i2pd`, `cjdns`, `wireguard`, `tailscale`, `headscale`, `zerotier`, `netbird`, `openssh`, `caddy`, `nginx`, `mkcert`, `joinmarket`, `jam`, `payjoin-cli`, `payjoin-dev-kit`, silent-payment indexers such as `frigate`, CoinJoin coordinators |
| `payments-sidechains-mining` | `btcpay-server`, `cashu-nutshell`, `cdk-mintd`, `fedimint`, `elements`, `sideswap`, `aqua-wallet`, Nostr Wallet Connect tooling such as `alby-js-sdk` (and the standard `nip-47`), `stratum-v2-reference-implementation`, `datum-gateway`, `public-pool`, `ckpool`, `braiins-os`, `bitaxe-axeos`, `cgminer` |
| `developer-tools-libraries` | `polar`, `nigiri`, `warnet`, `btcdeb`, `sim-ln`, `mutinynet`, faucets, `bitcoinjs-lib`, `scure-btc-signer`, `noble-curves`, `bitcoinerlab-descriptors`, `bitcoinerlab-miniscript`, `bdk`, `rust-bitcoin`, `rust-miniscript`, UR and BBQr libraries (`bc-ur`, `bbqr`), RPC and light-client libraries (`bitcoin-core-js`, `neutrino`, `kyoto`), backup tools such as `restic` and `kopia`, security tools such as `gpg4win`, emerging infrastructure such as `arkd`, and databases other entries depend on (`postgresql`, `mariadb`, `mongodb`, outside the catalogue) |
| `technology-platform` (tech-stack) | Tauri 2, its plugins and bundlers, WebView2, Rust toolchain, Windows build prerequisites, signing, the sidecar runtime and packaging, DPAPI and credential storage, SQLite access, desktop E2E testing, Windows OS integration |
| `technology-frontend` (tech-stack) | React, Vite, TypeScript, Tailwind CSS, shadcn/ui, Radix UI, Lucide, TanStack libraries, state, forms, validation, routing, charts, topology graphs, code editors, i18n and date formatting, QR libraries, unit and component testing, linting, monorepo tooling, Node integration libraries (ZeroMQ, gRPC, SSH, SOCKS, OpenPGP, archive extraction, logging, ORM) |
