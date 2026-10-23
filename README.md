<p align="center">
  <img src="apps/desktop/src-tauri/app-icon.png" alt="BTCortex" width="120" />
</p>

# BTCortex

[![CI](https://github.com/salmrcdev/BTCortex/actions/workflows/ci.yml/badge.svg)](https://github.com/salmrcdev/BTCortex/actions/workflows/ci.yml)
![Platform: Windows 10 / 11](https://img.shields.io/badge/platform-Windows%2010%20%2F%2011-0078D4)

[User guide](docs/USER_GUIDE.md) · [Development](docs/DEVELOPMENT.md) · [Architecture](docs/ARCHITECTURE.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

**BTCortex — Bitcoin ecosystem command centre for Windows.** One desktop application that installs, configures, connects and monitors the self-hosted Bitcoin ecosystem: nodes, Electrum servers, wallets, hardware wallets, Lightning, Tor and more. Users launch it and approve one recommended plan; BTCortex verifies the official releases, sets everything up for their computer and keeps it healthy.

Implementation coverage, verification evidence and operational constraints are documented in the [implementation status](docs/IMPLEMENTATION_STATUS.md) and [known limitations](docs/KNOWN_LIMITATIONS.md).

## Capabilities

- **Bitcoin Core, verified and managed.** Installation from bitcoincore.org after checking OpenPGP signatures from at least three pinned builders, the checksum and Windows' code signature; a hardware-aware set-up plan approved once; start, stop, restart and live monitoring (synchronisation, peers, mempool, storage); a configuration editor that explains every option; an RPC console with a read-only mode; Bitcoin Core already on the computer connected in one click, and nodes on other computers by RPC address. Bitcoin Knots can be set up the same way, after the user agrees that its current releases follow another chain.
- **Explorer** of blocks, transactions and addresses, straight from the user's own node, plus mempool and Esplora explorers on other computers followed and opened from it.
- **Electrum servers:** Fulcrum installed, configured, run and monitored next to a node, so that Sparrow, Electrum and Trezor Suite use the user's own server; optional access from other devices as an onion service.
- **Wallets:** Sparrow and Electrum installed from verified releases and connected to the node; hardware wallets (Trezor first) through HWI and Trezor Suite, with watch-only wallets on the node and PSBT signing that always ends on the device.
- **Tor and I2P:** the Tor Project's tor, verified and run by BTCortex, with nodes reaching the network through it; nodes can also use an I2P router already on the computer.
- **Lightning:** LND nodes on this computer or elsewhere, read with a read-only macaroon over a pinned certificate: channels and liquidity, payments, routing fees, warnings and channel backups.
- **Payments:** BTCPay Server watched read-only through its Greenfield API.
- **Monitoring and backups:** health checks, history and alerts for every component; backups of settings, configurations, wallets and LND channel backups (wallets and credentials only encrypted), each verified after writing, with bitcoin.conf and wallets restored from BTCortex.
- **Catalogue** of 134 ecosystem projects (from 176 researched, with 92 standards) with dated facts, Windows support and dependency checks.
- **Logs and diagnostics** from every component in one place, redacted, with a diagnostic bundle.
- **Safety throughout:** secrets protected with Windows DPAPI and never sent to the interface, redacted logs, chain pinning, confirmation for consequential actions, existing installations and wallets never touched.
- **Windows installer** (per user, no administrator rights) whose uninstaller keeps all data.

## Documentation

| Document                                                 | Content                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------ |
| [Installation](docs/INSTALLATION.md)                     | Installing, first start, data locations, uninstalling        |
| [User guide](docs/USER_GUIDE.md)                         | Every page of the application                                |
| [Node management](docs/NODE_MANAGEMENT.md)               | Bitcoin Core: installation, set-up, lifecycle, configuration |
| [Wallet integrations](docs/WALLET_INTEGRATIONS.md)       | Sparrow, Electrum, hardware wallets                          |
| [Lightning integrations](docs/LIGHTNING_INTEGRATIONS.md) | LND connections, macaroons, channel backups                  |
| [Privacy and Tor](docs/PRIVACY_AND_TOR.md)               | BTCortex's tor and what it protects                          |
| [Backup and recovery](docs/BACKUP_AND_RECOVERY.md)       | What to back up, what BTCortex backs up, how to recover      |
| [Remote management](docs/REMOTE_MANAGEMENT.md)           | Nodes and services on other computers                        |
| [Troubleshooting](docs/TROUBLESHOOTING.md)               | Common problems and what to do                               |
| [Architecture](docs/ARCHITECTURE.md)                     | Process model, boundaries, data locations, decisions         |
| [Security model](docs/SECURITY_MODEL.md)                 | Assets, trust boundaries, threats and controls               |
| [Implementation status](docs/IMPLEMENTATION_STATUS.md)   | What is implemented and tested, with evidence                |
| [Known limitations](docs/KNOWN_LIMITATIONS.md)           | Trade-offs and remaining work                                |
| [Ecosystem research](docs/ECOSYSTEM_RESEARCH.md)         | Verified facts about every researched project                |
| [Integration matrix](docs/INTEGRATION_MATRIX.md)         | Support level and Windows execution per project              |
| [Dependency matrix](docs/DEPENDENCY_MATRIX.md)           | Dependencies between components                              |
| [Development](docs/DEVELOPMENT.md)                       | Prerequisites, commands, conventions                         |
| [Plugin development](docs/PLUGIN_DEVELOPMENT.md)         | Adding an integration                                        |
| [Testing](docs/TESTING.md)                               | Test layers and the regtest environment                      |
| [Windows build](docs/WINDOWS_BUILD.md)                   | Building and testing the installers                          |
| [Release process](docs/RELEASE_PROCESS.md)               | Preparing, verifying and publishing a release                |
| [Design system](design-system/btcortex/MASTER.md)        | Visual language and accessibility rules                      |

## Quick start for developers

```bash
git clone https://github.com/salmrcdev/BTCortex.git
cd BTCortex
npm ci --ignore-scripts
npm run dev
```

Prerequisites: Windows 10 or 11 (x64), Node.js 26, Rust stable (MSVC) and the Visual Studio C++ workload with the Windows SDK. See [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

### Validation

```bash
npm run typecheck
npm run lint
npx vitest run --project node --project desktop
npm run research:validate
```

Integration tests run against verified services in disposable environments. Install their runtimes before running the full suite:

```bash
npx tsx scripts/dev/install-bitcoin-core.ts
npm test
```

Additional integration runtimes and native checks are documented in [`docs/TESTING.md`](docs/TESTING.md). CI runs type checking, lint, unit tests, component tests, research validation and a production build of the interface on Windows. It does not claim coverage of services whose runtimes are not installed.

## Repository layout

| Path                | Purpose                                                                |
| ------------------- | ---------------------------------------------------------------------- |
| `apps/desktop`      | React interface and Tauri native shell                                 |
| `apps/orchestrator` | Service lifecycle, verification, persistence and local RPC             |
| `packages`          | Shared contracts, Bitcoin configuration, RPC and integrations          |
| `tests/integration` | Tests against real services on disposable networks                     |
| `scripts`           | Development runtimes, research validation and release tooling          |
| `docs`              | User documentation, architecture, security and implementation evidence |
| `design-system`     | Interface specifications and accessibility rules                       |

## Technology

Tauri 2 with Microsoft Edge WebView2, React 19 and TypeScript (strict), Vite, Tailwind CSS v4 with shadcn/ui-style components on Radix primitives, TanStack Query and Router, Zod, Zustand and i18next. A TypeScript orchestrator runs as a Node.js single executable next to a deliberately small Rust shell. British English throughout.

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Include reproduction steps for bugs and distinguish observed behaviour from proposals. Report vulnerabilities privately through the process in [SECURITY.md](SECURITY.md).

## Licence

The project is currently marked `UNLICENSED`. No open-source licence has been selected. Third-party components retain their own licences; release tooling generates the corresponding notices.
