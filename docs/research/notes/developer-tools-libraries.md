# Developer tools, test networks, libraries, backup and security tools — research notes (scope `developer-tools-libraries`)

Verified on **2026-10-23**. Records: [`../data/developer-tools-libraries.json`](../data/developer-tools-libraries.json) (26 entries).

Sources were release pages and feeds, READMEs, licence files, the npm registry, crates.io and the projects' own sites. The database versions come from endoflife.date, a secondary source, which their records say. Anything unchecked is in each record's `unverifiedClaims`.

Projects owned by other scopes are referred to by canonical id only: `bitcoin-core`, `lnd`, `core-lightning`, `eclair`, `nbxplorer`, `mempool`, `bitcore-node`, `utreexod`.

---

## 1. Developer tools and test networks

| Entry | Latest | Windows | Licence | Notes |
|---|---|---|---|---|
| `polar` | 4.0.0 (2026-01-06) | **Yes**: installer (exe), but needs Docker Desktop | MIT | One-click regtest Lightning networks (LND, Core Lightning, Eclair, Bitcoin Core, Taproot Assets, Lightning Terminal) in Docker |
| `nigiri` | 0.5.17 (2026-05-13) | Partial: WSL strongly encouraged; Docker required | MIT | Regtest box: Bitcoin Core, electrs, Esplora on `localhost:5000`, Chopsticks (faucet) on 3000, optional Liquid, Lightning and Ark |
| `warnet` | 1.1.20 (2026-02-28) | Not stated | MIT | Network simulations with a chosen topology, optionally with Lightning, on a local or remote cluster |
| `btcdeb` | tag 5.0.24 (2023); pushed 2026-07-26 | No (Linux and macOS builds, Docker, Emscripten) | MIT | Script debugger (`btcdeb`) and compiler (`btcc`) |
| `sim-ln` | 0.2.5 (2025-06-24) | Not stated | MIT | Payment activity on LND, Core Lightning, Eclair and LDK Server nodes, or on a simulated network |
| `mutinynet` | — (public signet) | n/a | — | Explorer at mutinynet.com; faucet with an OpenAPI description (up to 1,000,000 sats per request, on chain or over Lightning, channel opening) |

BTCortex runs regtest, signet and testnet4 nodes natively, so it needs none of these. Polar is the closest to a Windows tool, but its Docker Desktop requirement conflicts with zero-touch installation. Public faucets for the default signet and testnet4 were not researched.

## 2. Libraries (not in the catalogue)

| Entry | Latest | Licence | Ecosystem |
|---|---|---|---|
| `bitcoinjs-lib` | 7.0.4 on npm (newest GitHub release 7.0.1, 2026-01-07) | MIT | npm, Node.js 18+ |
| `scure-btc-signer` | 2.4.1 (2026-08-29), "audited & minimal" | MIT | npm |
| `noble-curves` | 2.4.0 (2026-08-27), audited | MIT | npm |
| `bitcoinerlab-descriptors` | 3.2.0 (2026-08-30) | MIT | npm (bitcoinjs family; optional Ledger support) |
| `bitcoinerlab-miniscript` | 2.0.0 (2026-01-30) | MIT | npm |
| `bdk` (`bdk_wallet`) | 3.2.0 (2026-09-20) | MIT or Apache-2.0 | crates.io |
| `rust-bitcoin` (`bitcoin`) | 0.32.102 (2026-07-15) | CC0-1.0 | crates.io |
| `rust-miniscript` (`miniscript`) | 13.2.0 (2026-10-17) | CC0-1.0 | crates.io |
| `bc-ur` (`@ngraveio/bc-ur`) | 1.1.13 (2024-04-17) | MIT | npm; BTCortex uses it for UR QR codes |
| `bbqr` | 1.2.0 on npm | not stated | npm |
| `bitcoin-core-js` (`bitcoin-core`) | 5.0.0 (2025-01-23) | MIT | npm; BTCortex has its own RPC client |
| `neutrino` | tag 0.18.0 (2026-06-24) | MIT | Go; LND's light-client back end |
| `kyoto` (`bip157`) | 0.7.0 (2026-09-25) | MIT or Apache-2.0 | crates.io; BIP 157/158 light client |

Compact block filters (BIP 157/158) are served by Bitcoin Core with `blockfilterindex=1` and `peerblockfilters=1` (see `bitcoin-core`). Neutrino and Kyoto are clients of such peers.

## 3. Backup and security tools

- **restic** 0.19.1 (2026-07-05): encrypted, deduplicated snapshots.
  - Windows: x64 and x86 ZIPs with `SHA256SUMS` and its signature.
  - Licence: BSD-2-Clause.
- **Kopia** 0.23.1 (2026-06-16): incremental backups with client-side end-to-end encryption, compression and deduplication.
  - Windows: an x64 ZIP and `KopiaUI-Setup-0.23.1.exe`, with `checksums.txt` and its signature.
  - Licence: Apache-2.0.
- Either could copy BTCortex's backup folder off-site. BTCortex does not offer that yet, so both are `research-only`.
- **Gpg4win** 5.1.1 (2026-09-23): Windows 10 (1809 or later) and 11, 64-bit only since 5.0.0.
  - Licence: installer GPL-2.0-or-later, GnuPG GPL-3.0-or-later.
  - Bitcoin Core's manual verification uses GnuPG. BTCortex verifies signatures natively against pinned keys, so it does not need Gpg4win.

## 4. Emerging infrastructure

**arkd** 0.9.16 (2026-08-25) is the Arkade operator: off-chain execution with batch settlement on chain, and unilateral exit when the operator is unavailable. Its documentation calls it alpha, with limited mainnet testing; developers can run their own operator only in regtest. Nigiri can start Ark components for development.

## 5. Databases other entries depend on

`postgresql` (18.6, 2026-08-11; NBXplorer), `mariadb` (12.3.3 LTS, 2026-08-24; mempool) and `mongodb` (9.0.4, 2026-10-14; Bitcore Node) are recorded only so that those dependencies resolve. BTCortex installs none of them. Their versions come from endoflife.date; their licences (PostgreSQL, GPL-2.0, SSPL-1.0) were not checked on the vendors' pages.

## 6. Open questions

- Who signs restic's, Kopia's and Polar's checksums or installers.
- Warnet's cluster back ends and whether it runs on Windows.
- Mutinynet's signet parameters, and whether joining it needs a modified Bitcoin Core.
- BBQr's licence and the publication dates of bitcoinjs-lib 7.0.4 and bbqr 1.2.0.
