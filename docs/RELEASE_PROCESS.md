# Release process

How a BTCortex release is prepared, checked, built and published. BTCortex has not been released yet; the steps marked _not yet possible_ are the blockers that remain.

## Versions

BTCortex follows semantic versioning (`MAJOR.MINOR.PATCH`). One version is written in five places, which must agree:

| File                                     | Field                                                        |
| ---------------------------------------- | ------------------------------------------------------------ |
| `package.json`                           | `version`                                                    |
| `apps/desktop/package.json`              | `version`                                                    |
| `apps/orchestrator/package.json`         | `version` (built into the sidecar as `__BTCORTEX_VERSION__`) |
| `apps/desktop/src-tauri/tauri.conf.json` | `version` (installer names and Windows' uninstall entry)     |
| `apps/desktop/src-tauri/Cargo.toml`      | `version`                                                    |

The database schema has its own numbered migrations; a release that adds one must say so, because an older BTCortex refuses a newer database.

## 1. Refresh what BTCortex trusts

Every program BTCortex installs is verified against keys pinned in the repository. Before a release, refresh them and review the differences:

```bash
npm run update-keys --workspace @btcortex/integration-bitcoin-core -- <commit>   # builder keys from bitcoin-core/guix.sigs at a reviewed commit
npm run update-keys --workspace @btcortex/integration-bitcoin-knots -- <commit>  # builder keys from bitcoinknots/guix.sigs at a reviewed commit
npm run update-key  --workspace @btcortex/integration-tor            # Tor Project signing key
npm run update-key  --workspace @btcortex/integration-sparrow        # Craig Raw's key
npm run update-key  --workspace @btcortex/integration-hwi            # Ava Chow's key
npm run update-key  --workspace @btcortex/integration-fulcrum        # Calin Culianu's key
npm run update-keys --workspace @btcortex/integration-electrum-wallet # ThomasV and SomberNight
npm run update-keys --workspace @btcortex/integration-lnd            # LND's verify-install.sh keys and threshold
npm run update-key  --workspace @btcortex/integration-hardware-wallets # SatoshiLabs 2021 Signing Key (Trezor Suite)
```

A changed fingerprint is a change of trust: confirm it from at least one independent source before accepting it. The scripts for a single key (Tor, Sparrow, HWI, Fulcrum, Electrum and the SatoshiLabs key) refuse any key whose fingerprint is not the pinned one. The LND script trusts the fingerprints listed in LND's `verify-install.sh` at the release tag. The builder-key scripts for Bitcoin Core and Bitcoin Knots take every key in `builder-keys` at the commit given, so review `keys/bitcoin-core/manifest.json` and `keys/bitcoin-knots/manifest.json` key by key.

Refresh the research as well (`docs/research/data`, then `npm run research:docs`), so the catalogue's dates and versions are current, and check that `docs/IMPLEMENTATION_STATUS.md` (from `npm run status:docs`) matches what was actually tested.

## 2. Check

```bash
npm install
npm run typecheck
npm run lint
npm run format:check
npm test                                              # unit, component and integration
cd apps/desktop/src-tauri
cargo clippy --all-targets -- -D warnings
cargo fmt --check
cargo test
```

The integration tests need the verified test programs in `.test-env` (see [`TESTING.md`](TESTING.md)); they skip with a warning without them, which is not acceptable for a release.

## 3. Build

`npm run build` on Windows 10 or 11 x64 (see [`WINDOWS_BUILD.md`](WINDOWS_BUILD.md)): it builds and smoke-tests the orchestrator sidecar, builds the interface, and produces `BTCortex_<version>_x64-setup.exe` and `BTCortex_<version>_x64_en-US.msi` under `apps/desktop/src-tauri/target/release/bundle/`. When `@tauri-apps/cli` changed, compare BTCortex's copy of the NSIS template (`apps/desktop/src-tauri/windows/installer.nsi`) with the new version's.

The sidecar embeds the Node.js that runs the build (`node --build-sea`), so build with the newest release of the Node.js line in use, for its security fixes: the development builds so far used 26.4.0 (2026-06-24), while 26.12.1 (2026-10-21) was the newest 26.x on 2026-10-23 (`docs/research/tech-stack/technology-platform.json`).

## 4. Sign — _not yet possible_

Both `btcortex.exe` and the sidecar `btcortex-orchestrator.exe` must be Authenticode-signed, the sidecar after the application has been injected into the Node.js runtime (which invalidates Node's own signature), then the installers. This needs a code-signing certificate (or Azure Artifact Signing), which BTCortex does not have yet. Unsigned builds make Windows SmartScreen warn.

## 5. Test the installers

On a clean Windows 10 and a clean Windows 11 (virtual machines are fine):

1. Install silently (`/S`) and interactively; check the program folder, the shortcuts and the uninstall entry.
2. Start BTCortex without any development server; check that the interface is complete and the orchestrator connected.
3. Set up a regtest node, connect a wallet, start Tor.
4. Close BTCortex and check that managed programs stopped as their policies say.
5. Install the new version over the previous release and check that data and settings survive (_not tested yet for any version_).
6. Uninstall and check that `%LOCALAPPDATA%\BTCortex` is untouched.
7. Install the MSI as an administrator (_not tested yet_).

Record the results in `docs/WINDOWS_BUILD.md`.

## 6. Licences — _open before the first release_

- OpenPGP.js (LGPL-3.0-or-later) is not bundled into the orchestrator executable: the orchestrator build places the unmodified `openpgp.cjs`, its `LICENSE` and a `NOTICE.txt` (version and source location) in `apps/desktop/src-tauri/resources/openpgp`, the installer puts them in `openpgp\` beside the executables, and the orchestrator loads the file from there when it starts, so anyone can replace it. Check that the installed folder contains them.
- Programs BTCortex downloads at run time (Bitcoin Core, Bitcoin Knots, Tor, Fulcrum, Sparrow, Electrum, HWI, Trezor Suite; LND's installer is used only to set up the test environment) are not redistributed by BTCortex; they come from their publishers' own releases.
- `npm run licences` (part of `npm run build` and `npm run dev`) writes `THIRD_PARTY_LICENCES.txt`, installed beside the executables: every npm package in the lockfile outside devDependencies, every Rust crate linked into the shell on Windows (normal dependencies, no procedural macros), the Node.js runtime inside the orchestrator, each with its licence text, identical texts printed once. It reads `package-lock.json` and `Cargo.lock` offline; only Node.js's licence is fetched, once per version. Five packages carry no licence file (react-remove-scroll-bar, alloc-stdlib, selectors, webview2-com and webview2-com-sys); the list names their licence and repository. Read the new list before a release.

## 7. Publish

Publish the installers with a `SHA256SUMS` file signed by the BTCortex release key (to be created), release notes that state security fixes, data-format changes and anything that makes going back to an older version unsafe, and the implementation status of that version. Tag the release in the repository.
