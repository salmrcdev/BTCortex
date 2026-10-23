# Alternative full nodes, node platforms and monitoring — research notes (scope `full-nodes-alternatives-platforms`)

Verified on **2026-10-23**. Records: [`../data/full-nodes-alternatives-platforms.json`](../data/full-nodes-alternatives-platforms.json) (19 entries).

Every statement comes from a primary source fetched on that day: release pages, READMEs, licence files and official documentation. Anything that could not be checked is listed in the entry's `unverifiedClaims`.

Projects owned by other scopes are referred to by canonical id only: `bitcoin-core`, `bitcoin-knots`, `lnd`, `electrs`, `mempool`, `tor`, `wireguard`, `tailscale`.

---

## 1. Alternative full-node implementations

| Entry | Latest release | Windows | Licence | Status | BTCortex |
|---|---|---|---|---|---|
| `btcd` | v0.27.0, 2026-10-21 | ZIPs for x64 and x86, with a signed manifest of hashes | ISC | active | research-only, P3 |
| `utreexod` | v0.6.0, 2026-06-23 | ZIP for x64 | ISC | active, **beta** | research-only, P3 |
| `floresta` | v0.9.1, 2026-04-27 | no binaries; Unix and macOS build guides only | MIT OR Apache-2.0 | active | research-only, P3 |
| `libbitcoin` | v3.8.0, 2023-08-18 (no binaries) | unknown | AGPL-3.0-or-later with a section 7 permission | active repository, no recent release | research-only, P3 |
| `bcoin` | v2.2.0, 2021-11-12 | unknown | MIT | stale (last push 2024-02-12) | research-only, P3 |
| `gocoin` | 1.11.0, 2025-11-15 | ZIP (`gocoin-1.11.0-win.zip`) | non-commercial (`LicenseRef-Gocoin-Non-Commercial`) | active | research-only, P3 |

Findings:

- **None of them is a drop-in replacement for Bitcoin Core in BTCortex.** BTCortex's node features (wallet connections, the RPC console, ZMQ for Electrum servers, `getblockchaininfo`-based monitoring) were built and tested against Bitcoin Core and Bitcoin Knots. btcd says its API is "fully compatible with the original bitcoind/bitcoin-qt", but it has no wallet and serves RPC over TLS by default (certificate in `%LOCALAPPDATA%\Btcd`; ports 8334 mainnet, 18334 testnet3 and regtest, 48334 testnet4, 38332 signet). Supporting it would need its own adapter and tests.
- **btcd** is the only one with Windows archives for x64 and x86 and a manifest of hashes with a detached signature. The signing key was not identified, so BTCortex could not verify a download yet. LND can use btcd as its chain back end (see `lnd`).
- **utreexod** calls itself beta and advises against mainnet use beyond negligible amounts. **Floresta** has no Windows build guide. Its Electrum server answers only for the xpubs and descriptors it watches, so it cannot answer BTCortex's look-ups for arbitrary addresses. The Utreexo BIPs are still a work in progress.
- **Gocoin** has Windows binaries but needs at least 32 GB of RAM and is published under a non-commercial licence. BTCortex must never redistribute it.
- **bcoin** is stale and **libbitcoin** has not released since 2023. Both are recorded for completeness only.

## 2. Node platforms and guides

| Entry | Latest | Runs on | Licence | BTCortex |
|---|---|---|---|---|
| `umbrel` (umbrelOS) | 2.0.0, 2026-09-22 | Umbrel Home/Pro, x86-64 PCs, Raspberry Pi 5, EFI virtual machines; not on top of an existing Linux | PolyForm-Noncommercial-1.0.0 | connected-application, P2 |
| `start9` (StartOS) | v0.4.0.1, 2026-07-27 | x86_64, aarch64, riscv64 images, Raspberry Pi image | MIT | connected-application, P2 |
| `mynode` | v0.3.50, 2026-10-15 (CHANGELOG) | PC, Raspberry Pi, Model Two | CC BY-NC-ND 4.0 with an added section 9 (`LicenseRef-myNode`) | connected-application, P2 |
| `raspiblitz` | v1.12.1, 2026-03-03 | Raspberry Pi 4 and 5 (fat and min images) | MIT | connected-application, P2 |
| `nix-bitcoin` | v0.0.139, 2026-08-13, **the final release** | NixOS | MIT | connected-application, P3 |
| `raspibolt` | guide v4, updated August 2026 | Raspberry Pi with a 2 TB SSD (Debian commands) | MIT | connected-application, P3 |
| `minibolt` | guide; repository pushed 2026-08-10 | a personal computer (Debian-based commands) | MIT | connected-application, P3 |
| `parmanode` | no releases; pushed 2026-10-19 | desktop computers (systems not checked) | MIT | research-only, P3 |

Findings:

- **None of them runs natively on Windows.** They are operating systems or guides for a separate computer. umbrelOS can run in a virtual machine (VirtualBox and VMware are listed), but BTCortex does not set up virtual machines, and this was not tried on Windows.
- **How BTCortex works with them** ([`REMOTE_MANAGEMENT.md`](../../REMOTE_MANAGEMENT.md)): BTCortex connects to the services the platform's apps expose, with the remote connections it already has: a Bitcoin node's RPC, Electrum servers, block explorers (mempool, Esplora), LND and BTCPay Server. It holds only each service's own credentials. It does not use the platforms' own interfaces, logins or app stores. Nothing has to be installed on Windows, hence the `high` feasibility.
- **nix-bitcoin has ended.** Its v0.0.139 release notes call it "the final release of nix-bitcoin" and give no successor. It last updated bitcoind to 31.1. Its users get no further security updates from the project.
- **Licences matter for redistribution**:
  - umbrelOS (PolyForm Noncommercial) and myNode (a non-commercial, no-derivatives Creative Commons licence with an extra clause about the product key and premium features) are not open source in the OSI sense.
  - BTCortex links to them and never bundles them.
- **StartOS 0.4.0** cannot restore backups made with earlier versions, according to its release notes.
- **myNode v0.3.50** adds optional automatic upgrades and asks for the password before sensitive actions.

## 3. Monitoring

| Entry | Latest | Windows | Licence | BTCortex |
|---|---|---|---|---|
| `prometheus` | v3.15.1, 2026-10-21 | ZIP and tar.gz for x64, x86 and ARM64 | Apache-2.0 | research-only, P3 |
| `grafana` | v13.2.4, 2026-10-13 | installer or ZIP (Enterprise recommended, Open Source available); NSSM for a service | AGPL-3.0 (Open Source edition) | research-only, P3 |
| `bitcoin-prometheus-exporter` | v0.9.0, 2025-09-24 | not documented (Python; Docker image) | BSD-3-Clause | research-only, P3 |
| `peer-observer` | no releases | not stated (eBPF extractor via libbpf-rs) | MIT | research-only, P3 |
| `fork-observer` | no releases | not stated | MIT | research-only, P3 |

Findings:

- BTCortex has its own monitoring: health checks, history and alerts (the Monitoring page; see [`USER_GUIDE.md`](../../USER_GUIDE.md#monitoring)). Prometheus and Grafana matter to users who already run a monitoring stack.
  - The useful integration would be for BTCortex to publish its own metrics in Prometheus' format. That is not built.
  - Prometheus listens on port 9090 and Grafana on port 3000 by default.
- **bitcoin-prometheus-exporter** reads Bitcoin Core over RPC (`BITCOIN_RPC_HOST`, `BITCOIN_RPC_USER`, `BITCOIN_RPC_PASSWORD`). The README states no default port; 9332 comes from its Docker example.
  - A user limited with `rpcwhitelist` to the read-only calls it makes is the safe way to run it.
- **peer-observer** is research tooling for dedicated honeynodes. It needs elevated privileges for tracepoints and a Bitcoin Core with some unmerged patches, and its own README calls the set-up non-trivial.
- **fork-observer** watches chain tips and stale blocks across many nodes.
  - Back ends: Bitcoin Core RPC (`getchaintips`, `getblockhash`, `getblockheader`, optionally `getnetworkinfo`, `getblock`, `waitfornewblock`) and REST, or btcd, Esplora, mempool.space, block-dn and Electrum.
  - The README recommends a whitelisted RPC user rather than cookie authentication.
  - Its example configuration serves the web interface on `127.0.0.1:2323`.

## 4. Open questions

- The key that signs btcd's release manifest, and whether utreexod and Gocoin publish signed checksums.
- How each platform exposes its Bitcoin node's RPC, its Electrum server and LND to other computers (addresses, certificates, Tor). This needs one installation of each to check against; none was available on this computer.
- Which operating systems Parmanode supports, and what it installs (its documentation moved to parman.org).
- Whether Floresta builds on Windows.
