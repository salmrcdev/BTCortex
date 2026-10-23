# Wallets, multisig coordinators, hardware wallets and air-gapped signing — technical reference (scope `wallets-hardware`)

Verified on **2026-10-21**. Records: [`../data/wallets-hardware.json`](../data/wallets-hardware.json) (37 ecosystem entries) and [`../data/standards-wallets-hardware.json`](../data/standards-wallets-hardware.json) (38 standards).

This is the reference the engineers will build BTCortex's wallet connection wizard, hardware-wallet integration and air-gapped PSBT tooling from (specification sections 8, 9, 14, 18 and 39). Every statement was checked against a primary source fetched on the verification date: release pages and feeds, signed checksum files (several signatures were verified with GnuPG in an isolated keyring), source code at the release tag, official documentation and issue trackers. Where something could not be verified it says so, and the JSON records list it under `unverifiedClaims`.

Projects owned by other scopes are referred to by canonical id only: `bitcoin-core`, `bitcoin-knots`, `fulcrum`, `electrs`, `electrumx`, `electrum-personal-server`, `bwt`, `tor`, `frigate`, `joinmarket`, `btcpay-server`, `gpg4win`. Bitcoin Core's own GUI wallet belongs to `bitcoin-core`.

**Ground rules that apply to every flow in this document** (specification 8.2 and 9): BTCortex never asks for, stores, transmits or derives from a seed phrase; it never creates hot wallets in third-party applications; it never initiates signing or broadcasting on its own; watch-only data is never presented as the ability to spend; device registration (multisig, wallet policies) is always a visible, user-confirmed device action.

---

## 0. Key facts at a glance

| Entry | Category | Maintenance | Latest stable (date) | Windows native | Recommended level | Priority |
|---|---|---|---|---|---|---|
| `sparrow` | desktop-wallet | active | 2.5.5 (2026-09-17) | yes (x64) | `fully-managed` | P1 |
| `electrum` | desktop-wallet | active | 4.8.2 (2026-09-11) | yes (x64) | `fully-managed` | P1 |
| `hwi` | signing-tool | **maintenance-only** (feature freeze, final release announced) | 3.2.0 (2026-02-10) | yes (x64) | `fully-managed` | P1 |
| `specter-desktop` | multisig-coordinator | active (upkeep releases) | 2.1.11 (2026-08-09) | yes (x64) | `connected-application` | P2 |
| `liana` | desktop-wallet | active | 15.0 (2026-08-01) | yes (x64) | `connected-application` | P2 |
| `nunchuk` | multisig-coordinator | active | 2.9.1 (October 2026) | yes (x64) | `external-launcher` | P2 |
| `bitcoin-safe` | desktop-wallet | active | 2.1.3 (2026-08-05) | yes (x64) | `connected-application` | P2 |
| `wasabi-wallet` | desktop-wallet | active | 2.8.4 (2026-10-13) | yes (x64) | `fully-managed` | P2 |
| `caravan` | multisig-coordinator | active | coordinator 1.19.2 (2026-07-20) | partial (browser app) | `external-launcher` | P3 |
| `blockstream-app` | desktop-wallet | active | 3.6.0 (2026-09-21) | yes (x64) | `external-launcher` | P3 |
| `bitcoin-keeper` | mobile-wallet | active (community-run) | mobile 2.6.3 (2026-10-07); Keeper Desktop 0.2.5 (2026-10-06) | partial (companion only) | `research-only` | P3 |
| `trezor-suite` | desktop-wallet | active | 26.9.3 (2026-10-01) | yes (x64) | `external-launcher` | P2 |
| `ledger-live` (now "Ledger Wallet") | desktop-wallet | active | 4.24.0 (2026-10-14) | yes (x64) | `external-launcher` | P2 |
| `bitboxapp` | desktop-wallet | active | 4.52.0 (2026-09-15) | yes (x64) | `connected-application` | P2 |
| `coldcard` | hardware-wallet | active | 5.6.3 (Mk4/Mk5) and 1.5.3Q (Q), 2026-09-30; EDGE 6.6.1X | n/a | `connected-application` | P2 |
| `trezor` | hardware-wallet | active | core 2.12.5 (2026-09-16); legacy 1.14.1 (2026-03-18) | n/a | `connected-application` | P2 |
| `ledger` | hardware-wallet | active | Bitcoin app 2.5.1 (2026-09-09) | n/a | `connected-application` | P2 |
| `bitbox02` | hardware-wallet | active | 9.27.1 (2026-09-15) | n/a | `connected-application` | P2 |
| `jade` | hardware-wallet | active | 1.0.41 (2026-08-22, security release) | n/a | `connected-application` | P2 |
| `passport` | hardware-wallet | active | KeyOS 1.3.0 (Prime, 2026-07-17); 2.3.11 (Core, December 2025) | n/a | `connected-application` | P2 |
| `keystone` | hardware-wallet | active | 3.1.4 (2026-10-16) | n/a | `connected-application` | P2 |
| `seedsigner` | hardware-wallet | active | 0.8.7 (2026-07-08) | n/a | `connected-application` | P2 |
| `krux` | hardware-wallet | active | 26.09.0 (2026-10-03) | n/a | `connected-application` | P3 |
| `krux-installer` | other | active | 0.0.24 (2026-10-03) | yes (x64, unsigned) | `external-launcher` | P3 |
| `specter-diy` | hardware-wallet | active | 1.10.5 (2026-09-06) | n/a | `research-only` | P3 |
| `keepkey` | hardware-wallet | active | 7.16.0 (2026-10-16) | n/a | `connected-application` | P3 |
| `tapsigner` | hardware-wallet | active | no published firmware | n/a | `research-only` | P3 |
| `satochip` | hardware-wallet | active | applet 0.16-0.1 pre-release (2026-10-16) | n/a | `research-only` | P3 |
| `frostsnap` | hardware-wallet | active | 0.4.0 (2026-08-25) | n/a | `research-only` | P3 |
| `bhwi` | library | active (work in progress) | none (tag v0.1 only) | unknown | `research-only` | P3 |
| `trezor-bridge` | other | **superseded** | 2.0.33 (2023-04-17) | — | `unsupported` | P3 |
| `ledger-satstack` | other | **discontinued** (archived 2025-06-01) | 0.19.0 (2023-06-02) | — | `unsupported` | P3 |
| `bitbox01` | hardware-wallet | **discontinued** | — | n/a | `unsupported` | P3 |
| `armory` | desktop-wallet | **stale** | 0.96.5 (2018-12-24); 0.97 RC1 test build 2026-05-20 | yes (x64) | `research-only` | P3 |
| `lily-wallet` | multisig-coordinator | **stale** | 1.4.0 (2023-10-12) | yes | `research-only` | P3 |
| `ashigaru-terminal` | desktop-wallet | unknown (legally sensitive context) | 1.0.0 (2025-06-23) | yes (Tor-only download) | `research-only` | P3 |
| `whirlpool-gui` | transaction-privacy | **discontinued** (servers seized 2024) | — | — | `unsupported` | P3 |

**The pruned-node recipe in one paragraph** (details in §6.2). With Bitcoin Core ≥ 24 (BTCortex manages 31.1) running as the same Windows user with `server=1`, wallets enabled and initial block download finished, and **no Sparrow process running**, merge into `%APPDATA%\Sparrow\config` (JSON; for test networks `%APPDATA%\Sparrow\<testnet3|testnet4|signet|regtest>\config`): `"serverType": "BITCOIN_CORE"`, `"coreServer": "http://127.0.0.1:8332"`, `"coreAuthType": "COOKIE"`, `"coreDataDir": "<Core data directory, for example C:\\Users\\<user>\\AppData\\Local\\Bitcoin>"`, `"useLegacyCoreWallet": false`, plus `"mode": "ONLINE"` if the user approved this connection in the plan. Then start `Sparrow.exe -n mainnet`. Sparrow creates and loads the descriptor watch-only wallet `cormorant` in Core (`load_on_startup=true`), imports its wallets' descriptors and refuses birthdays earlier than the prune date. BTCortex must keep `cormorant` loaded and never modify it.

**Contradictions with the specification's assumptions**

1. **"Prefer integration with … HWI" (spec 9) needs an exit plan.** HWI's maintainer pinned issue [#850](https://github.com/bitcoin-core/HWI/issues/850) on 2026-08-18: feature freeze, no new devices, the next release "will likely be the final release of HWI", then archiving once a replacement is ready. HWI 3.2.0 already cannot drive the **Trezor Safe 7** (mandatory Trezor-Host Protocol, [#775](https://github.com/bitcoin-core/HWI/issues/775)) or the **Ledger Nano Gen5** (master only). Sparrow no longer uses HWI at all (its own Java library, Lark, does support the Safe 7). BTCortex should put HWI behind a replaceable signer adapter and delegate device work to Sparrow by default.
2. **"Bitcoin Core → Fulcrum → Sparrow" (spec 8, Profile B) cannot run on the test machine.** Every Electrum server needs an unpruned node (see the electrum-indexers-explorers notes). On the 73 GB machine the only end-to-end wallet flow is **Bitcoin Core (pruned) → Sparrow directly**, and restoring wallets older than the prune height is impossible.
3. **Electrum cannot connect to Bitcoin Core at all.** It needs an Electrum server, so on a pruned machine it can only use public servers (privacy loss, opt-in) or a remote own server. Its 4.9 plan ([#10989](https://github.com/spesmilo/electrum/issues/10989)) is to require Electrum protocol 1.7, which Fulcrum 2.1.4 (≤ 1.6) and electrs 0.12 (1.4) do not implement.
4. **"Bitcoin Core → Specter Desktop → Hardware Wallet" (spec 8) works only with BTCortex corrections.** Specter Desktop is in upkeep mode (dependency, CI and security releases), upstream CI tests bitcoind 27.2.0, nothing claims Core 30/31 support, its Windows autodetect only knows `%APPDATA%\Bitcoin`, it reads the network only from `testnet=1`/`signet=1`/`regtest=1`, it has no testnet4 and it creates Core wallets without `load_on_startup` (a pruning hazard).
5. **Most air-gapped devices named in spec 9 are not HWI devices.** Passport, Keystone, SeedSigner, Krux and Specter DIY need animated QR (UR or BBQr) or microSD files; Tapsigner and Satochip need PC/SC readers. BTCortex needs its own UR/BBQr module or must delegate to Sparrow.
6. **"Firmware/version information where safely available" is not provided by HWI.** `hwi enumerate` returns model, path, label and fingerprint but no firmware version; versions come from vendor protocols (Trezor `Features`, BitBox02 device info, Jade `get_version_info`, `ckcc version`) or vendor apps.
7. **Hardware-wallet bridges (spec 39) are obsolete for Trezor.** The standalone Trezor Bridge is deprecated and should be uninstalled; Trezor Suite runs its own bridge, and HWI and Sparrow talk to devices directly. Ledger's own-node bridge SatStack is archived; **Ledger Wallet (formerly Ledger Live) cannot use the user's node**.
8. **Caravan has no Windows build.** It is a browser app; using a private Bitcoin Core node needs a CORS proxy.
9. **A July 2026 COLDCARD seed-entropy incident** (funds stolen; updating firmware does not repair affected seeds) must be surfaced whenever a COLDCARD is involved.
10. **Wasabi Wallet has no default CoinJoin coordinator** since zkSNACKs closed its coordinator on 2024-06-01; BTCortex must never choose one for the user.
11. **Electrum's PSBT QR codes are not UR or BBQr** (base43) until 4.9, so Electrum air-gapped flows must use files.
12. **Vendor apps cannot always be pre-configured**: Trezor Suite keeps custom back ends in renderer storage, Nunchuk in undocumented registry values, Ledger Wallet has no own-node option, and Liana has no Tor/SOCKS support at all.

---

## 1. Landscape

### 1.1 Categories

| Group | Entries | BTCortex role |
|---|---|---|
| Node-connected desktop wallets | `sparrow` (Core RPC or Electrum), `liana` (Core RPC or Electrum, miniscript), `bitcoin-safe` (compact block filters, Electrum, Esplora), `wasabi-wallet` (compact block filters over P2P or Core RPC, CoinJoin), `electrum` (Electrum servers only), `blockstream-app` (Electrum, Blockstream back end) | Install, verify, pre-configure the back end, launch, update |
| Multisig coordinators | `specter-desktop`, `nunchuk`, `caravan` (also `sparrow`, `liana`, `bitcoin-safe`) | Pre-configure where documented; otherwise launch with exact connection values |
| Vendor companion apps | `trezor-suite`, `ledger-live`, `bitboxapp`, `krux-installer`, Keeper Desktop (`bitcoin-keeper`) | Install and launch for firmware, app and pairing maintenance; close them before HWI/Sparrow use the device |
| USB signers (HWI or vendor libraries) | `coldcard`, `trezor`, `ledger`, `bitbox02`, `jade`, `keepkey` | Discovery, watch-only import, address display, explicit signing (via `hwi`) or delegation to Sparrow |
| Air-gapped QR/microSD signers | `coldcard` (microSD, Q: BBQr), `jade` (QR mode), `passport`, `keystone`, `seedsigner`, `krux`, `specter-diy` | PSBT and descriptor exchange via files or animated QR; delegation to Sparrow |
| Smartcards and threshold devices | `tapsigner`, `satochip`, `frostsnap` | Research only; Sparrow path documented |
| Interface libraries | `hwi`, `bhwi` (and Sparrow's embedded Lark, Liana's async-hwi) | Signer adapter |

### 1.2 Discontinued, superseded, stale or legally sensitive

- `trezor-bridge`: standalone Trezor Bridge deprecated by Trezor ("has deprecated the standalone Trezor Bridge"); last trezord-go release 2.0.33 (2023-04-17). Detect it (port 21325) and recommend uninstalling.
- `ledger-satstack`: archived 2025-06-01; broke with Ledger Live 2.53+.
- `bitbox01`: end of sale 2019-11-12; last BitBoxApp with full support 4.37.3; Electrum 4.8.2 shows a deprecation warning for the `digitalbitbox` and `safe_t` plugins.
- `armory`: last stable 0.96.5 (2018-12-24); a 0.97 RC1 test build appeared on 2026-05-20; 0.96.5 is not expected to read Core 28+ XOR-obfuscated block files.
- `lily-wallet`: no commits since 2023-08-14; Elastic License 2.0 (source-available).
- `whirlpool-gui` and Samourai Wallet: discontinued after the April 2024 indictment and server seizure; the founders were sentenced in November 2025 (search extract of the US Attorney's press release). `ashigaru-terminal` (an anonymous fork-based Whirlpool client, Tor-only downloads) is recorded as `research-only` and not catalogue-eligible. CoinJoin coordinators themselves belong to the privacy-networking scope.
- `hwi`: maintenance-only (see contradiction 1). `specter-desktop`: active but upkeep-only in 2026.
- COLDCARD Mk1–Mk3 (final firmware 3.0.6 and 4.2.0) and Passport Core (no longer produced, still updated) are folded into their entries.
- Ledger Live was renamed **Ledger Wallet** on 2025-10-23; Blockstream Green was renamed **Blockstream App** in 2.0.26 (2025-07-10); Bitcoin Keeper moved to the community-run KeeperCommunity organisation.

### 1.3 Gap analysis (spec 39): checked but not recorded

Desktop wallets and services:

| Project | Finding | Why not recorded |
|---|---|---|
| Bitcoin Core GUI wallet | Owned by `bitcoin-core` | Other scope |
| BlueWallet | iOS and Android, plus an APK and a macOS build; no Windows ([bluewallet.io](https://bluewallet.io/)) | No Windows desktop build |
| Proton Wallet | Web app plus iOS and Android, open source; no desktop app mentioned ([proton.me/wallet](https://proton.me/wallet)) | Web and mobile only; no own-node option documented |
| Envoy | Passport's companion app for iOS, Android and F-Droid ([foundation.xyz/envoy](https://foundation.xyz/envoy/)) | Mobile; covered under `passport` |
| Cove | iOS and Android, open source, PSBT, BBQr and NFC with Coldcard, Krux and Tapsigner ([covebitcoin.com](https://covebitcoin.com/)) | Mobile only |
| Bull Bitcoin wallet | MIT; Android, iOS and Linux; own Electrum server, hardware wallets, PSBTs ([repository](https://github.com/SatoshiPortal/bullbitcoin-mobile)) | No Windows build |
| Mycelium | Android, with Trezor, Ledger and KeepKey support ([wallet.mycelium.com](https://wallet.mycelium.com/)) | Mobile only |
| Cake Wallet | Multi-asset, MIT; iOS, Android and Linux; silent payments ([cakewallet.com](https://cakewallet.com/)) | No Windows build listed |
| Exodus | exodus.com returned HTTP 403 to the fetcher | Unverified; known as a closed-source multi-asset wallet (unverified) |
| Casa, Unchained | Collaborative-custody services ([casa.io](https://casa.io/), [unchained.com](https://www.unchained.com/)) | Hosted services; Unchained's open-source coordinator is `caravan` |
| FullyNoded | iOS and macOS, Bitcoin Core RPC ([Start9 guide](https://docs.start9.com/bitcoin-guides/1.0.x/bitcoin-wallets.html)) | No Windows |
| Electron Cash | Bitcoin Cash wallet ([electroncash.org](https://electroncash.org/)) | Not Bitcoin |
| Bisq | Decentralised exchange with Windows builds ([bisq.network](https://bisq.network/)) | An exchange, not a wallet; candidate for the payments scope |
| Sparrow Server, Lark, KeepKey Vault, ckcc, cktap, Wasabi 1.x | Covered inside `sparrow`, `bhwi`, `keepkey`, `coldcard`, `tapsigner`, `wasabi-wallet` | Folded into entries |

Signing devices:

| Device | Finding | Why not recorded |
|---|---|---|
| OneKey (Classic 1S, Pro) | App 6.6.1 (2026-10-09), firmware-pro 4.21.0 incl. a BTC-only build ([firmware-pro](https://github.com/OneKeyHQ/firmware-pro/releases)); **supported by Sparrow's Lark library** ([Lark README](https://github.com/sparrowwallet/lark/blob/master/README.md)); not in HWI | Multi-asset; desktop PSBT interoperability beyond Sparrow not researched — candidate for a later pass |
| Cypherock X1 | Firmware 0.6.3341 (2026-10-09) ([releases](https://github.com/Cypherock/x1_wallet_firmware/releases)); no documented PSBT/descriptor interoperability with desktop coordinators | Not interoperable as far as verified |
| Bitkey (Block) | App 2026.16.1 (2026-10-20) ([bitkey](https://github.com/proto-at-block/bitkey/releases)); mobile-first 2-of-3 with Block's server | No desktop coordinator workflow |
| Portal (Twenty Two) | Last firmware 0.3.4 (2025-02-13) ([portal-software](https://github.com/TwentyTwoHW/portal-software/releases)) | Stale, NFC/mobile |
| NGRAVE ZERO | QR-only, paired with a mobile app; no PSBT/Sparrow support stated ([ngrave.io](https://www.ngrave.io/)) | Not interoperable as far as verified |
| ELLIPAL Titan, Arculus | Vendor sites returned HTTP 429/403 on 2026-10-21 | Unverified; recheck later |

---

## 2. Compatibility matrices

### 2.1 Wallets and coordinators: back ends, Windows and Tor

| Wallet | Windows artefacts (x64) | Bitcoin Core RPC directly | Electrum server | Other back ends | Works with the pruned test node | Tor / proxy |
|---|---|---|---|---|---|---|
| `sparrow` 2.5.5 | Per-user MSI; **portable ZIP** | **Yes**: Core ≥ 24, cookie or user/password, descriptor watch-only wallet `cormorant` | Yes (TCP/TLS, certificate pinning) | Public Electrum servers | **Yes** (new wallets; rescans start after the prune date) | Internal Tor (automatic for .onion) or SOCKS |
| `electrum` 4.8.2 | Setup (admin); **standalone and portable EXE** | No | Yes (protocol 1.4–1.6; `oneserver` + `serverfingerprint`) | Public servers | No (needs an Electrum server) | SOCKS4/5 (no bundled Tor) |
| `specter-desktop` 2.1.11 | Per-user NSIS GUI; **specterd ZIP** | Yes (descriptor path; Core 30/31 untested upstream) | Via bundled Spectrum | — | New wallets only (UTXO scan uses an explorer) | SOCKS, built-in Tor, hidden service |
| `liana` 15.0 | **Standalone EXE** (unsigned) | Yes (≥ 24.0.1), cookie or user/password; can also download its own Core (avoid) | Yes | Liana Connect (hosted) | Yes (rescans not below `pruneheight`) | **None** |
| `nunchuk` 2.9.1 | Inno Setup (admin); **portable ZIP** (unsigned) | Yes, user/password only (no cookie) | Yes (default: Nunchuk's server) | — | New wallets (`wallet=nunchuk` needed) | SOCKS5 |
| `bitcoin-safe` 2.1.3 | Setup (admin); **portable EXE** (SignPath-signed) | In code, user/password (UI exposure unverified) | Yes | Esplora; **compact block filters (default)** | Yes, via filters from random peers | SOCKS |
| `wasabi-wallet` 2.8.4 | MSI (admin); **ZIP** | Optional: filters, blocks, fees, broadcast (`blockfilterindex=1`) | No | **Compact block filters over P2P (default)** | Yes per FAQ (untested) | **Bundled Tor**, on by default |
| `caravan` 1.19.2 | None (browser; Docker image) | Via a CORS proxy | No | Esplora APIs (mempool.space default) | New wallets only | Browser-level only |
| `blockstream-app` 3.6.0 | Inno Setup (admin) | No | Personal Electrum server (single-sig only) | Blockstream back end (multisig) | No | Built-in Tor or SOCKS |
| `bitcoin-keeper` (Keeper Desktop 0.2.5) | Tauri NSIS/MSI companion | No | Own Electrum server (phone app) | Optional Keeper server key | No | Yes (per third-party index) |
| `trezor-suite` 26.9.3 | NSIS (per-user possible) | No | Yes (`host:port:s`) | Blockbook | No | Bundled Tor |
| `ledger-live` 4.24.0 | NSIS per-machine | **No** (SatStack archived) | No | Ledger's servers | No | — |
| `bitboxapp` 4.52.0 | NSIS (admin) | No | Yes (`config.json`) | Shift servers by default | No | SOCKS5 |

### 2.2 Wallets and coordinators: signing, PSBT and formats

| Wallet | USB signers | Air-gapped and formats | PSBT | Multisig | Miniscript | BIP329 labels |
|---|---|---|---|---|---|---|
| `sparrow` | Lark library: Coldcard, Trezor (incl. Safe 7), Ledger, BitBox02, Jade, KeepKey, OneKey; PC/SC: Tapsigner, Satschip, Satochip, Keycard | Animated QR **UR and BBQr**, raw QR, microSD files; import formats for Passport, Keystone, SeedSigner, Krux, Jade, Coldcard, Specter DIY and others; BSMS | v0 and v2 (v2 internal default since 2.4.0) | Yes: bare, P2SH, P2SH-P2WSH, P2WSH | No (no Taproot multisig; script-tree descriptors rejected) | **Yes** (import and export) |
| `electrum` | Own plugins: Trezor (Safe 7 since 4.8.0), Ledger (Nano Gen 5 since 4.7.1), Coldcard, BitBox02, Jade, KeepKey; BitBox01 and Safe-T deprecated | Files; QR in Electrum's base43 format only (UR planned for 4.9) | **v0 only** | Yes: P2SH, P2SH-P2WSH, P2WSH; Nostr Cosigner plugin | No | No (PR #8614 open) |
| `specter-desktop` | Bundled HWI **3.1.0** (Coldcard, Trezor, Ledger, BitBox02, KeepKey, Jade, Specter DIY) | QR (Keystone, Passport, SeedSigner, Specter DIY), SD card | Yes | Yes (nested and native SegWit) | No | No (PR #2712 open) |
| `liana` | async-hwi: Ledger, Coldcard EDGE, BitBox02, Jade, Specter DIY | Krux via SD card; no QR signing | Files | Yes, inside miniscript policies | **Yes** (core feature) | Export (`getlabelsbip329`) |
| `nunchuk` | Bundled **HWI fork** (nogibi/HWI 3.2.4) | QR, SD; Tapsigner over NFC (mobile) | Yes | Yes | Announced 2025-08 (desktop coverage unverified) | Not found |
| `bitcoin-safe` | HWI ≥ 3.2.0 via bitcoin-usb | **UR and BBQr** QR, SD | Yes | Yes (PDF backup sheets) | Not documented | **Yes** |
| `wasabi-wallet` | Bundled HWI 3.1.0: Trezor Model T, Ledger Nano S/S Plus/X, Coldcard, BitBox02 (incl. Nova), Jade; no Trezor One | Coldcard microSD PSBT files | Yes | No | No | No |
| `caravan` | Trezor, Ledger (policy HMACs), BitBox, Jade via browser USB | Coldcard, Hermit files; BC-UR 2 QR | Yes | Yes (only) | No | No |
| `blockstream-app` | Jade, Jade Plus, Ledger | Jade QR | Not documented | Blockstream-cosigned 2-of-2/2-of-3 | No | No |

### 2.3 Signing devices

| Device | Latest firmware | Connection | HWI 3.2.0 | QR / file formats | Multisig | Miniscript / policies | Desktop coordinators verified |
|---|---|---|---|---|---|---|---|
| COLDCARD Mk4/Mk5 (`coldcard`) | 5.6.3 (2026-09-30) | microSD, USB HID, NFC, Virtual Disk | Yes (no Taproot inputs in the matrix) | PSBT files (`-part`, `-signed`, `-final.txn`), PSBT v2 | Yes, ≤ 15; COLDCARD text or descriptor import | EDGE track only (miniscript, Taproot, BSMS preview) | Sparrow, Electrum, Specter, Nunchuk, Liana (EDGE), Bitcoin-Safe, Wasabi (files) |
| COLDCARD Q | 1.5.3Q (2026-09-30) | as above plus QR scanner, two microSD slots | Yes | **BBQr** (≤ 2 MiB), base64/hex PSBT QR | as above | EDGE only | as above; BBQr with Sparrow, Nunchuk, Bitcoin-Safe |
| Trezor Safe 3/5, Model T, Model One (`trezor`) | core 2.12.5; legacy 1.14.1 | USB (WinUSB/WebUSB; HID on old Model One) | Yes | Host-built PSBT over USB; no QR | P2SH, P2SH-P2WSH, P2WSH ≤ 15; no registration | No | Suite, Sparrow, Electrum, Specter, Bitcoin-Safe, Caravan, Wasabi (Model T) |
| Trezor Safe 7 | core 2.12.5 | USB-C, Bluetooth; **THP mandatory** | **No** (#775) | as above | as above | No | Suite, Sparrow (Lark), Electrum ≥ 4.8.0, Bitcoin-Safe |
| Ledger Nano S Plus/X/Flex/Stax (`ledger`) | Bitcoin app 2.5.1 (2026-09-09) | USB HID (Bluetooth for mobile) | Yes (Bitcoin app open) | PSBT over USB | Yes, registered on device (≤ 15) | **BIP388 policies**, wsh/tr miniscript, `musig()` | Sparrow, Electrum, Specter, Liana, Nunchuk, Wasabi, Bitcoin-Safe, Caravan |
| Ledger Nano Gen5 | Bitcoin app 2.5.1 | USB-C, Bluetooth, NFC | Master only | as above | as above | as above | Electrum ≥ 4.7.1, Liana (listed), Ledger Wallet |
| BitBox02 / Nova (`bitbox02`) | 9.27.1 (2026-09-15) | USB-C (Nova Bluetooth for iOS only) | Yes (Nova since 3.2.0) | PSBT over USB | P2WSH, P2SH-P2WSH, registered | wsh and Taproot miniscript policies | BitBoxApp, Sparrow, Electrum, Specter, Liana, Wasabi, Bitcoin-Safe, Caravan |
| Jade Classic/Plus/Core (`jade`) | 1.0.41 (2026-08-22) | USB serial, Bluetooth, QR (Classic, Plus), USB storage (Plus, Core) | Yes (Plus since 3.2.0; Core untested) | UR `crypto-psbt`, `crypto-account`/`crypto-hdkey` | 16 registrations | 16 BIP388 policies | Blockstream App, Sparrow, Electrum, Specter, Nunchuk, Liana, Bitcoin-Safe, Wasabi |
| Passport Core / Prime (`passport`) | 2.3.11 / KeyOS 1.3.0 | QR, microSD (Core USB is power-only); Prime pairs with Envoy | No | UR 2.0 animated QR, files | Yes | Core 2.4.0 betas only | Sparrow, Specter, Nunchuk, Electrum, Bitcoin-Safe |
| Keystone 3 Pro, BTC Only (`keystone`) | 3.1.4 (2026-10-16) | QR, microSD | No | Animated UR | Yes (≥ 1.1.0-BTC) | Not stated | Sparrow ≥ 1.8.5, Nunchuk, Bitcoin-Safe |
| SeedSigner (`seedsigner`) | 0.8.7 (2026-07-08) | QR only | No | UR; BBQr decode | Yes | Not listed | Sparrow, Specter, Nunchuk |
| Krux (`krux`) | 26.09.0 (2026-10-03) | QR, SD | No | UR, BBQr, pMofN, files | Yes | wsh and Taproot miniscript | Sparrow, Specter, Liana, Bitcoin-Safe, Nunchuk |
| Specter DIY (`specter-diy`) | 1.10.5 (2026-09-06) | QR, USB text protocol, SD | No | Base64 PSBT QR, signed result stripped | Yes | wsh miniscript | Specter Desktop, Liana (USB) |
| KeepKey (`keepkey`) | 7.16.0 (2026-10-16) | USB | Yes | PSBT over USB | P2SH, P2SH-P2WSH, P2WSH | No (no Taproot) | KeepKey Vault, Sparrow, Electrum |
| TAPSIGNER (`tapsigner`) | — | NFC through a PC/SC reader | No | Card signs digests | As one key | No | Sparrow, Nunchuk |
| Satochip (`satochip`) | applet 0.16-0.1 pre-release | NFC or contact, PC/SC | No | Host builds the PSBT | Not stated | No | Sparrow, Satochip's Electrum fork |
| Frostsnap (`frostsnap`) | 0.4.0 (2026-08-25) | USB-C to the Frostsnap app | No | Not PSBT (FROST) | FROST threshold | No | Frostsnap app only |

### 2.4 What works on the test machine (5.9 GB RAM, ~73 GB free, pruned mainnet node)

| Flow | Works? | Why |
|---|---|---|
| Bitcoin Core (pruned) → `sparrow` (Cormorant) | **Yes** | New wallets; rescans limited to blocks after the prune date |
| Bitcoin Core (pruned) → `hwi` → Core watch-only wallet (BTCortex-native) | Yes | `importdescriptors` timestamps no earlier than the prune height |
| Bitcoin Core (pruned) → `liana` | Yes | Rescans not below `pruneheight` |
| Bitcoin Core (pruned) → `wasabi-wallet` (RPC, `blockfilterindex=1`) | Probably | Documented in the FAQ; untested; the filter index adds disk use |
| `bitcoin-safe` with compact block filters from random peers | Yes | Using the own node as filter peer needs `listen=1` and `peerblockfilters=1` (conflicts with the zero-touch default `listen=0`) |
| Bitcoin Core (pruned) → `specter-desktop`, `nunchuk`, `caravan` | New wallets only | Untested on Core 31.1 (Specter); wallets must be kept loaded |
| Bitcoin Core → Fulcrum → `sparrow`, `electrum`, `bitboxapp`, `trezor-suite`, `blockstream-app` | **No** | Electrum servers need an unpruned node (and `txindex` for Fulcrum) |
| `electrum` (installed 4.7.2) with public servers | Works, privacy loss | Opt-in only, clearly labelled external |

---

## 3. Sparrow (`sparrow`) — integration details (P1, `fully-managed`)

### 3.1 Release, Windows artefacts and verification

- **Latest: 2.5.5, published 2026-09-17** ([release](https://github.com/sparrowwallet/sparrow/releases/tag/2.5.5); earlier 2.5.4 2026-08-27, 2.5.3 2026-07-30, 2.5.0 2026-05-21, 2.4.0 2026-02-10 from the [releases feed](https://github.com/sparrowwallet/sparrow/releases.atom)). Latest master commit 2026-10-20. Apache-2.0.
- **Windows assets** ([assets](https://github.com/sparrowwallet/sparrow/releases/expanded_assets/2.5.5), [download page](https://sparrowwallet.com/download/): "Windows 10+"):
  - `Sparrow-2.5.5.msi` (94.3 MB): jpackage-built WiX MSI with `--win-per-user-install`, `--win-menu`, `--win-menu-group Sparrow`, `--win-shortcut` and file associations for `.psbt`, `.txn` and `.asc` ([build.gradle](https://github.com/sparrowwallet/sparrow/blob/2.5.5/build.gradle)). The customised WiX template registers the **`bitcoin:`, `lightning:` and `auth47:` URI schemes** ([main.wxs](https://github.com/sparrowwallet/sparrow/blob/2.5.5/src/main/deploy/package/windows/main.wxs)); `InstallScope` is per-user, `Platform="x64"`.
  - `Sparrow-2.5.5.zip` (93 MB): the standalone jpackage application image with its own Java runtime (no installer, no registry entries). **Preferred for zero-touch.**
  - No arm64 Windows build. Linux and macOS packages and the Linux-only headless **Sparrow Server** are listed in the entry.
- **Verification** (download page): `sparrow-2.5.5-manifest.txt` lists SHA-256 values for every artefact; `sparrow-2.5.5-manifest.txt.asc` is a detached signature by **Craig Raw, RSA-4096 `D4D0 D320 2FC0 6849 A257 B38D E946 1833 4C67 4B40`**. Verified on 2026-10-21 in an isolated GnuPG home with the key from [keybase.io/craigraw](https://keybase.io/craigraw/pgp_keys.asc): "Good signature", signature made 2026-09-17 with SHA-512. The key was created 2019-10-03 and **expires 2027-09-18**: pin the fingerprint and re-fetch the key when its expiry is extended. Manifest values: ZIP `da62b27effb93e83cc8fba4705248a03ec6683577c32aa6bc32801dc3b89b6e7`, MSI `0256eb5c8808157f811d57fbdb9f9153101b02947c2f6788f1e7b9da5ff6111f`. Sparrow ≥ 1.8.3 can also verify downloads itself (Tools > Verify Download).
- Authenticode status of `Sparrow.exe` and the MSI was not checked (unverified).

### 3.2 Zero-touch installation and update

1. Fetch `https://api.github.com/repos/sparrowwallet/sparrow/releases/latest` (tag, date) and download `Sparrow-<v>.zip`, `sparrow-<v>-manifest.txt` and `.asc` from `https://github.com/sparrowwallet/sparrow/releases/download/<v>/`.
2. Verify the signature (pinned fingerprint) and then the ZIP's SHA-256 line; refuse on any mismatch.
3. Extract to `%LOCALAPPDATA%\BTCortex\apps\sparrow\<v>\` (no elevation). Expected layout `Sparrow\Sparrow.exe` plus `app\` and `runtime\` (jpackage convention; not inspected).
4. Updates replace the versioned folder while Sparrow is closed; `%APPDATA%\Sparrow` is untouched ("Uninstalling or upgrading is safe if you close the app first", download page).
5. Only if the user asks for Start-menu integration or URI handlers: `msiexec /i Sparrow-<v>.msi /qn` (per-user; default folder and upgrade behaviour untested). Warn that it takes over `bitcoin:`/`lightning:` handlers.

### 3.3 Files and folders on Windows

All directory categories resolve to **`%APPDATA%\Sparrow`** on Windows (XDG resolution applies only to macOS/Linux; [ApplicationDir.java](https://github.com/sparrowwallet/drongo/blob/e1c26413e4973752c9d7d43e37e39b411f21b48c/src/main/java/com/sparrowwallet/drongo/ApplicationDir.java)); `-d <folder>` (system property `sparrow.home`) replaces it entirely. Mainnet uses the root; other networks use subfolders named by `Network.getHome()`: **`testnet3`**, `testnet4`, `signet`, `regtest` (an old `testnet` folder is renamed to `testnet3` on first use; [Storage.java](https://github.com/sparrowwallet/sparrow/blob/2.5.5/src/main/java/com/sparrowwallet/sparrow/io/Storage.java), [Network.java](https://github.com/sparrowwallet/drongo/blob/e1c26413e4973752c9d7d43e37e39b411f21b48c/src/main/java/com/sparrowwallet/drongo/Network.java)).

| Path (mainnet) | Content |
|---|---|
| `%APPDATA%\Sparrow\config` | JSON configuration (below) |
| `%APPDATA%\Sparrow\wallets\*.mv.db` | H2 wallet databases (encrypted with the wallet password when set) — **never read** |
| `%APPDATA%\Sparrow\certs\<host>` | Pinned TLS certificates (Electrum servers, HTTPS Core endpoints) |
| `%APPDATA%\Sparrow\sparrow.log` | Log file |
| `%APPDATA%\Sparrow\sparrow.lock` | AF_UNIX single-instance socket ([Instance.java](https://github.com/sparrowwallet/sparrow/blob/2.5.5/src/main/java/com/sparrowwallet/sparrow/instance/Instance.java)) |
| `%APPDATA%\Sparrow\network-testnet`, `network-testnet4`, `network-signet` | Marker files that force the network at start-up |
| `%APPDATA%\Sparrow\testnet4\config` etc. | Per-network configuration, wallets, certificates and logs |

### 3.4 Configuration keys

The file is written by Gson with pretty printing; `File` values are stored as absolute path strings and `Server` values as `url` or `url|alias` ([Config.java](https://github.com/sparrowwallet/sparrow/blob/2.5.5/src/main/java/com/sparrowwallet/sparrow/io/Config.java), [Server.java](https://github.com/sparrowwallet/sparrow/blob/2.5.5/src/main/java/com/sparrowwallet/sparrow/io/Server.java), [Protocol.java](https://github.com/sparrowwallet/sparrow/blob/2.5.5/src/main/java/com/sparrowwallet/sparrow/net/Protocol.java)). `Config` has an implicit no-argument constructor, so **omitted keys keep their defaults**. A file that fails to parse is replaced by defaults (and rewritten on the next setter), so BTCortex must write valid JSON atomically.

| Key | Type / values | Default | Meaning for BTCortex |
|---|---|---|---|
| `mode` | `ONLINE`, `OFFLINE` | null → Welcome dialog | Set `ONLINE` only when the user approved the connection |
| `serverType` | `BITCOIN_CORE`, `ELECTRUM_SERVER`, `PUBLIC_ELECTRUM_SERVER` | null | Back-end selection |
| `coreServer` | `http://127.0.0.1:8332` (or `https://…`; alias optional) | null | Core RPC URL; port defaults per network when omitted |
| `coreAuthType` | `COOKIE`, `USERPASS` | null | Use `COOKIE` locally |
| `coreDataDir` | absolute path | null | **Must be set** for cookie auth (else "Bitcoin Core data folder or user and password is required") |
| `coreAuth` | `"user:password"` | null | Plain text — avoid; only for remote nodes with a dedicated `rpcauth` user |
| `useLegacyCoreWallet` | boolean | false | **Must stay false** (true forces the bwt/legacy-wallet path, impossible on Core ≥ 30) |
| `legacyServer` | boolean | false | Leave untouched |
| `electrumServer` | `ssl://127.0.0.1:50002` or `tcp://…` (alias optional) | null | Private Electrum server |
| `electrumServerCert` | absolute path to a PEM file | null | Pins a self-signed server certificate; must exist |
| `publicElectrumServer` | server URL | null | Never set silently |
| `useProxy`, `proxyServer` | boolean, `"host:port"` | false, null | SOCKS proxy (BTCortex `tor`: `127.0.0.1:9050`) |
| `autoSwitchProxy` | boolean | true | FAQ: change only while Sparrow is closed |
| `recentCoreServers`, `recentElectrumServers` | lists | empty | UI history |
| `checkNewVersions` | boolean | true | Sparrow's own update notice |
| `enumerateHwPeriod` | seconds | 30 (maintainer) | USB polling interval; raise to reduce device contention |
| `maxServerTimeout`, `maxPageSize` | ints | constants | Leave untouched |
| `walletsDir`, `recentWalletFiles`, `hideAmounts`, `theme`, `webcamDevice`, … | various | — | User preferences: never touch |

**Every setter rewrites the whole file** (`flush()`), so changes made while Sparrow runs are lost or overwritten. Edit only when no `Sparrow.exe` process runs and no live `sparrow.lock` socket answers.

### 3.5 Command-line flags and network selection

`Sparrow.exe [-d|--dir <home>] [-n|--network <mainnet|testnet|testnet4|signet|regtest>] [-l|--level <level>] [-t|--terminal] [-v|--version] [-h|--help] [file or URI …]` ([Args.java](https://github.com/sparrowwallet/sparrow/blob/2.5.5/src/main/java/com/sparrowwallet/sparrow/Args.java), [SparrowWallet.java](https://github.com/sparrowwallet/sparrow/blob/2.5.5/src/main/java/com/sparrowwallet/sparrow/SparrowWallet.java)). Since 2.5.5 unknown options exit with an error and `--option=value` is accepted.

Network precedence: `-n` beats the `SPARROW_NETWORK` environment variable, **but marker files `network-testnet`, `network-testnet4` or `network-signet` in `%APPDATA%\Sparrow` (created by "Restart in Testnet") override both**. BTCortex must check for these files before launching a mainnet profile. The FAQ still lists only mainnet, testnet, regtest and signet; `testnet4` is in the code.

Single instance: a second launch on the same home and network connects to `sparrow.lock`, hands over its file/URI arguments and exits. BTCortex can therefore open a PSBT in a running Sparrow with `Sparrow.exe C:\path\tx.psbt`.

### 3.6 Bitcoin Core back end (Cormorant)

Source: [BitcoindClient.java](https://github.com/sparrowwallet/sparrow/blob/2.5.5/src/main/java/com/sparrowwallet/sparrow/net/cormorant/bitcoind/BitcoindClient.java), [BitcoindClientService.java](https://github.com/sparrowwallet/sparrow/blob/2.5.5/src/main/java/com/sparrowwallet/sparrow/net/cormorant/bitcoind/BitcoindClientService.java), [BitcoindTransport.java](https://github.com/sparrowwallet/sparrow/blob/2.5.5/src/main/java/com/sparrowwallet/sparrow/net/cormorant/bitcoind/BitcoindTransport.java), [Cormorant.java](https://github.com/sparrowwallet/sparrow/blob/2.5.5/src/main/java/com/sparrowwallet/sparrow/net/cormorant/Cormorant.java), [ElectrumServer.java](https://github.com/sparrowwallet/sparrow/blob/2.5.5/src/main/java/com/sparrowwallet/sparrow/net/ElectrumServer.java).

- **Version gate:** `getnetworkinfo.version < 240000` → "Bitcoin Core versions older than v24 are not supported". On that error, or when `useLegacyCoreWallet` is true, Sparrow falls back to bwt with a legacy wallet named `sparrow`, which needs legacy RPCs removed in Core 30.0. The documentation page still describes bwt for "versions before v24".
- **Synchronisation:** if `initialblockdownload` is true and networking is active, Cormorant waits until the node has synchronised.
- **Wallet support:** `listwallets` must work ("Wallet support must be enabled in Bitcoin Core").
- **The `cormorant` wallet:** `loadwallet cormorant load_on_startup=true`, or if not found `createwallet` with `wallet_name=cormorant`, `disable_private_keys=true`, `blank=true`, `passphrase=""`, `avoid_reuse=true`, `descriptors=true`, `load_on_startup=true`, `external_signer=false`. All Sparrow wallets are tracked in this one Core wallet; the maintainer says it should not be managed externally ([#1874](https://github.com/sparrowwallet/sparrow/issues/1874)).
- **Imports:** `importdescriptors` with a range of 1000 per chain (4000 for Whirlpool postmix), sorted to avoid deadlocks.
- **RPC methods used (22)** — the basis for a remote `rpcwhitelist`: `createwallet`, `estimatesmartfee`, `getblockchaininfo`, `getblockhash`, `getblockheader`, `getblockstats`, `getmempoolentry`, `getmempoolinfo`, `getnetworkinfo`, `getrawmempool`, `getrawtransaction`, `gettransaction`, `getwalletinfo`, `importdescriptors`, `listdescriptors`, `listsinceblock`, `listwalletdir`, `listwallets`, `loadwallet`, `sendrawtransaction`, `unloadwallet`, `uptime`.
- **Cookie:** `<coreDataDir>\.cookie` (mainnet) or `<coreDataDir>\testnet3|testnet4|regtest|signet\.cookie` when that file exists; re-read whenever its modification time changes, so node restarts are handled. `coreDataDir` is always the root data directory.
- **Transport:** URL `<coreServer>/wallet/cormorant`; connect timeout 15 s (60 s through a proxy), read timeout ≥ 300 s. HTTPS endpoints pin the server certificate on first use.
- **Internal Electrum bridge:** Cormorant serves the Electrum protocol to Sparrow on `127.0.0.1` with an ephemeral port ([ElectrumServerRunnable.java](https://github.com/sparrowwallet/sparrow/blob/2.5.5/src/main/java/com/sparrowwallet/sparrow/net/cormorant/electrum/ElectrumServerRunnable.java)); nothing listens on other interfaces.
- **Trust:** merkle-proof verification is skipped in Core mode ("the node answering is the user's own"), so a post-fork Bitcoin Knots node would silently move the wallet to Knots' chain.
- **Silent payments:** "Scanning silent payment wallets is not currently supported with Bitcoin Core"; SP wallets need an SP-capable Electrum server (`frigate`).
- **Non-wallet transactions:** `blockchain.transaction.get` maps to `getrawtransaction`, which needs `txindex=1` for transactions outside the wallet and mempool. Not possible when pruned; 2.5.5 handles missing input transactions in fee and diagram views.

### 3.7 Pruned nodes

From the same source and the [connect-node documentation](https://sparrowwallet.com/docs/connect-node.html):

- Sparrow reads `pruned` and `pruneheight`, fetches the header of the prune-height block and uses its time as the **prune date**.
- A wallet whose birthday is earlier than the prune date is refused with "Error: Wallet birthday earlier than Bitcoin Core prune date"; rescans start no earlier than the prune date **plus two hours** (`PRUNED_RESCAN_TIMEGAP_MILLIS = 7200 s`).
- Documentation: "you won't be able to scan for transactions earlier than whatever the earliest retained (unpruned) block is"; un-pruning needs a full re-sync.
- Maintainer advice for existing wallets on a pruned node ([#1874](https://github.com/sparrowwallet/sparrow/issues/1874), December 2025): create and rescan the wallet on an archival node, then copy the Core wallet with both applications closed; forcing imports over missing history is refused because "you can't scan data that isn't there".
- `blockfilterindex=1` (Core 25+) speeds up rescans and is compatible with pruning; `txindex=1` is impossible.
- The `cormorant` wallet must stay loaded at every node start; otherwise Core refuses it later with "Prune: last wallet synchronisation goes beyond pruned data" (see the full-nodes-core notes §6.9).

### 3.8 Electrum-server and public back ends

- `serverType` `ELECTRUM_SERVER`, `electrumServer` `ssl://127.0.0.1:50002` (or `tcp://127.0.0.1:50001` on loopback), `electrumServerCert` pointing at the managed server's PEM certificate; otherwise the certificate is pinned on first use under `certs\<host>`.
- Sparrow offers Electrum protocol versions `1.3` and `1.4.2` and enables batching for Fulcrum ≥ 1.6.0, electrs ≥ 0.9.0, ElectrumX, mempool-electrs and Frigate.
- 2.5.5 refuses chain tips that do not link to its pinned headers and verifies server-reported heights.
- `PUBLIC_ELECTRUM_SERVER` uses a public server; choosing "offline" in the Welcome dialog on mainnet sets a random public server ([SparrowDesktop.java](https://github.com/sparrowwallet/sparrow/blob/2.5.5/src/main/java/com/sparrowwallet/sparrow/SparrowDesktop.java)). BTCortex must never select public servers silently.

### 3.9 Tor and proxy

- With `useProxy=true` and `proxyServer="127.0.0.1:9050"`, all external connections use the proxy except 10/8, 172.16/12 and 192.168/16 addresses ([FAQ](https://sparrowwallet.com/docs/faq.html)).
- Without a proxy, Sparrow starts its **internal Tor** (kmp-tor runtime) automatically when an `.onion` server is configured.
- "Although connecting to Bitcoin Core over Tor is possible, it is fairly slow"; over Tor, broadcasts go "through a public server".

### 3.10 Hardware wallets, QR and formats

- **USB:** the Lark library ([README](https://github.com/sparrowwallet/lark/blob/master/README.md); Java port of HWI, Apache-2.0, no releases) — Coldcard, Trezor (including the Safe 7 with THP; 2.5.5 fixes its session recovery), Ledger, BitBox02, Jade, KeepKey and OneKey Classic 1S/Pro. Sparrow does **not** ship `hwi.exe` any more ([Hwi.java](https://github.com/sparrowwallet/sparrow/blob/2.5.5/src/main/java/com/sparrowwallet/sparrow/io/Hwi.java)).
- **Smartcards:** Tapsigner, Satschip, Satochip and Keycard through a PC/SC reader ([docs](https://www.sparrowwallet.com/docs/airgapped-wallet-smartcard.html)).
- **QR:** encodings UR (Hummingbird library), BBQr (capped at 1295 parts) and raw; webcam scanning with zbar by default.
- **Formats:** output descriptors, BSMS (BIP129 with first-address validation), BIP329 labels, Coldcard, Keystone, Passport, Jade, Krux, SeedSigner, Specter DIY and Specter Desktop, Caravan, BlueWallet, Cobo Vault, AirGap Vault, Gordian Seed Tool, Electrum, Samourai, codex32 (BIP93) and SLIP-39.
- **Policies:** single-signature HD, multisignature HD (bare, P2SH, P2SH-P2WSH, P2WSH) and single-signature silent payments only; no Taproot multisig, no general miniscript ([ScriptType.java](https://github.com/sparrowwallet/drongo/blob/e1c26413e4973752c9d7d43e37e39b411f21b48c/src/main/java/com/sparrowwallet/drongo/protocol/ScriptType.java)).
- **Device contention:** Sparrow polls USB every 30 s by default; the maintainer suggests raising `enumerateHwPeriod` if devices misbehave ([#1840](https://github.com/sparrowwallet/sparrow/issues/1840)). BTCortex must not run HWI while Sparrow is open.

### 3.11 Pitfalls

- Sparrow's built-in suggestion for the Core folder is `%APPDATA%\Bitcoin` if it exists, otherwise `%LOCALAPPDATA%\Bitcoin` ([ServerSettingsController.java](https://github.com/sparrowwallet/sparrow/blob/2.5.5/src/main/java/com/sparrowwallet/sparrow/settings/ServerSettingsController.java)); a custom `-datadir` must be written explicitly.
- Network marker files silently override `-n`.
- Config edits while Sparrow runs are overwritten.
- The MSI hijacks `bitcoin:`/`lightning:` handlers.
- Restoring an old wallet on a pruned node fails by design; explain before the user starts.
- The test machine's Electrum + EPS-style history cannot be migrated into a pruned Sparrow setup without an archival node (#1874).

---

## 4. Electrum (`electrum`) — integration details (P1, `fully-managed`)

### 4.1 Release, Windows artefacts and verification

- **Latest: 4.8.2 (2026-09-11)**; 4.8.1 2026-08-10, 4.8.0 2026-07-08, 4.7.2 2026-04-01, 4.7.1 2026-02-26, 4.7.0 2026-01-22 — **every one labelled a security update** ([RELEASE-NOTES](https://github.com/spesmilo/electrum/blob/4.8.2/RELEASE-NOTES)). Latest master commit 2026-10-20. MIT.
- **Windows** ([electrum.org](https://electrum.org/)): Windows 10 (1809)+, x86_64 only. From `https://download.electrum.org/<v>/`:
  - `electrum-<v>-setup.exe`: NSIS installer;
  - `electrum-<v>.exe`: standalone, uses `%APPDATA%\Electrum`;
  - `electrum-<v>-portable.exe`: data in `electrum_data` next to it.
- All three are Authenticode-signed (per the [build README](https://github.com/spesmilo/electrum/blob/4.8.2/contrib/build-wine/README.md)) and reproducible, and each has a detached `.asc`.
- **Signers of 4.8.2** (all five signatures in each `.asc`, made 2026-09-12, identified with the keys in [`pubkeys/`](https://github.com/spesmilo/electrum/tree/4.8.2/pubkeys)):

| Signer | Fingerprint | Note |
|---|---|---|
| ThomasV | `6694 D8DE 7BE8 EE56 31BE D950 2BD5 824B 7F94 70E6` | RSA-4096, no expiry |
| SomberNight (release key) | `0EED CFD5 CAFB 4590 6734 9B23 CA9E EEC4 3DF9 11DC` | RSA-4096, no expiry |
| Emzy | signing subkey `637D B1E2 3370 F84A FF88 CCE0 3152 347D 07DA 627C` (primary `9EDA FF80 E080 6596 04F4 A76B 2EBB 056F D847 F8A7`) | **Subkey expired 2026-10-12** in the copy shipped with 4.8.2 |
| felixb_f321x | `AA0B C682 4B39 7BBA 9977 6E15 7ED8 D82B 3719 2688` | NIST P-256 |
| svanstaa | `33C1 03B4 B279 4170 546C CF7B CFB2 C83C 66CD 792A` | RSA-4096 |

BTCortex should require a valid signature from ThomasV or SomberNight's release key and treat the others as additional. Strict verifiers may reject Emzy's signature after its subkey's expiry.

### 4.2 Install modes

| Mode | Admin | Data folder | Notes |
|---|---|---|---|
| Standalone `electrum-<v>.exe` | No | `%APPDATA%\Electrum` | **Preferred by BTCortex**: place in `%LOCALAPPDATA%\BTCortex\apps\electrum\<v>\` |
| Portable `electrum-<v>-portable.exe` | No | `electrum_data` in the working directory | For isolated BTCortex profiles |
| Installer `electrum-<v>-setup.exe` | **Yes** — quits with error 740 without admin | `%APPDATA%\Electrum` | Installs to `%ProgramFiles%\Electrum`; runs `RMDir /r "$INSTDIR\*.*"` before copying (never use `/D=` with a shared folder); writes `HKCU\Software\Electrum`, an HKCU uninstall key and HKCU URI handlers for `bitcoin:`, `lightning:`, `lnurlp:` and `lnurlw:`; aborts (silently, `/SD IDCANCEL`) if Electrum's executables are in use ([electrum.nsi](https://github.com/spesmilo/electrum/blob/4.8.2/contrib/build-wine/electrum.nsi)). Silent switch `/S` (standard NSIS; untested). |

Detection: `HKCU\Software\Electrum` (install folder), `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Electrum` (`DisplayVersion`), running `electrum*.exe`, `%APPDATA%\Electrum\config`. An elevated installer run under a different administrator account writes these HKCU keys into that account's hive.

### 4.3 Configuration

`user_dir()` order ([util.py](https://github.com/spesmilo/electrum/blob/4.8.2/electrum/util.py)):

1. the `ELECTRUMDIR` environment variable;
2. on Windows, `%APPDATA%\Electrum`, else `%LOCALAPPDATA%\Electrum`.

`--dir` and `--portable` override both. Other chains use subfolders named `testnet`, `testnet4`, `regtest`, `signet`, `simnet` and `mutinynet` ([constants.py](https://github.com/spesmilo/electrum/blob/4.8.2/electrum/constants.py)).

The file `config` is JSON written with `indent=4, sort_keys=True` and owner-only permissions. An unparsable file stops start-up ("Invalid config file") ([simple_config.py](https://github.com/spesmilo/electrum/blob/4.8.2/electrum/simple_config.py)).

| Key | Example | Meaning |
|---|---|---|
| `server` | `"127.0.0.1:50002:s"` (`:t` for TCP) | Selected server |
| `oneserver` | `true` | "Only connect to one server (full trust)" — own server only |
| `auto_connect` | `false` | Do not switch servers automatically |
| `serverfingerprint` | 64 hex characters | SHA-256 of the server certificate; requires `server` and locks it in the GUI |
| `proxy` | `"socks5:127.0.0.1:9050"` | `socks5:host:port` or `socks4:host:port` (type prefix optional), or `none` |
| `enable_proxy` | `true` | Proxy switch (defaults to true when `proxy` is set) |
| `proxy_user`, `proxy_password` | — | Optional |
| `noonion`, `offline`, `skipmerklecheck` | — | Leave false |
| `check_updates` | `false` (default) | Update check |
| `rpcuser`, `rpcpassword`, `rpchost`, `rpcport` | — | Daemon RPC (secret: redact) |
| `config_version` | `3` | Keep as written |
| `terms_of_use_accepted` | — | **Never write**: the user accepts Electrum's terms in the GUI |
| `forget_config` | — | Do not save changes |

**Safer pre-configuration**: command-line options override the file for that session, are never written back, and lock those keys in the GUI.

```text
electrum-4.8.2.exe --oneserver --server 127.0.0.1:50002:s --serverfingerprint <sha256-hex> [--testnet4] [--proxy socks5:127.0.0.1:9050]
```

Persisting the same keys is possible only while Electrum is closed (merge, keep `config_version` and unknown keys, write atomically).

### 4.4 Command-line flags

([commands.py](https://github.com/spesmilo/electrum/blob/4.8.2/electrum/commands.py))

- **Global:**
  - `-v` (verbosity), `-D/--dir`, `-w/--wallet`, `-P/--portable`;
  - chain flags `--testnet`, `--testnet4`, `--regtest`, `--signet`, `--mutinynet`, `--simnet`;
  - `-o/--offline`, `--rpcuser`, `--rpcpassword`, `--forgetconfig`, `--nohardening` (Linux).
- **Network:** `-f/--serverfingerprint`, `-1/--oneserver`, `-s/--server host:port:t|s`, `-p/--proxy`, `--proxyuser`, `--proxypassword`, `--noonion`, `--skipmerklecheck`.
- **GUI:** `-g/--gui {qt,text,stdio,qml}`, `-m` (hide), `-L/--lang`, `--daemon`, `--nosegwit`.

### 4.5 Servers, Tor, hardware wallets, PSBT, QR, multisig

- **Servers:**
  - Electrum negotiates protocol 1.4–1.6 ([version.py](https://github.com/spesmilo/electrum/blob/4.8.2/electrum/version.py)) and by default keeps about ten connections for header checks.
  - With `oneserver` it trusts one server fully, so set it only for the user's own server.
  - Since 4.7.0 it refuses servers with another genesis hash.
  - It cannot use Bitcoin Core directly.
- **Tor:** no bundled Tor; the proxy dialog probes 127.0.0.1:9050, 9051 and 9150 ([network.py](https://github.com/spesmilo/electrum/blob/4.8.2/electrum/network.py), util.py).
- **Hardware plugins** ([plugins](https://github.com/spesmilo/electrum/tree/4.8.2/electrum/plugins)) use vendor libraries, not HWI:
  - `trezor`: Safe 7 since 4.8.0, trezorlib ≥ 0.20.0;
  - `ledger`: Nano Gen 5 since 4.7.1, ledger_bitcoin ≥ 0.4.1;
  - `coldcard` (multisig export over USB);
  - `bitbox02` (7.0.0; Nova);
  - `jade`, `keepkey`;
  - deprecated with a warning since 4.8.2: `digitalbitbox`, `safe_t`.
  - There is no Satochip plugin upstream.
- **PSBT:** version 0 only. **QR:** Electrum's base43 PSBT format; BC-UR animated QR is planned for 4.9, BBQr is not planned ([#10989](https://github.com/spesmilo/electrum/issues/10989); UR PR [#10518](https://github.com/spesmilo/electrum/pull/10518) closed unmerged 2026-10-13).
- **Multisig:** P2SH, P2SH-P2WSH and P2WSH, with the Nostr Cosigner plugin (`psbt_nostr`) for exchanging PSBTs. No miniscript.
- **Labels:** the LabelSync plugin and Electrum's own label JSON; BIP329 is an open PR ([#8614](https://github.com/spesmilo/electrum/pull/8614)).

### 4.6 The test machine's Electrum 4.7.2

- It is installed in `C:\Program Files\Electrum` with data in `%APPDATA%\Electrum`; wallet files were not read.
- It lacks three security releases (4.8.0: CVE-2012-2459 SPV fix; 4.8.1 and 4.8.2: further reported issues and hardening). BTCortex should flag it as outdated.
- Upgrading needs the admin installer (same folder) or a switch to the standalone executable.
- A newer version upgrades wallet files, which 4.7.2 may then not open (inference). Recommend upgrading the installed copy rather than running two versions side by side.

### 4.7 Planned 4.9 breaks (issue #10989, may change)

Python 3.11 minimum; **Electrum protocol 1.7 as the minimum** (would exclude Fulcrum 2.1.4 and electrs 0.12 unless they add 1.7); BC-UR animated QR for PSBTs; a new KDF for wallet encryption (downgrades become impossible). BTCortex must pin Electrum to 4.8.x for Fulcrum/electrs back ends until the server side supports protocol 1.7.

---

## 5. HWI (`hwi`) — integration details (P1, `fully-managed`, maintenance-only upstream)

### 5.1 Release and verification

- **3.2.0, published 2026-02-10** ([release](https://github.com/bitcoin-core/HWI/releases/tag/3.2.0)): "Jade Plus Support", "BitBox02 Nova support", "Testnet4 Support", "Jade native PSBT signing", "PSBT MuSig2 fields". Previous: 3.1.0 (2024-09-17), 3.0.0 (2024-04-06).
- Latest master commit 2026-08-25: "Optionally pass BIP388 policy to signtx" (unreleased).
- Windows: `hwi-3.2.0-windows-x86_64.zip` (60 113 236 bytes) containing `hwi.exe` and `hwi-qt.exe` (PyInstaller); no installer, no arm64 build.
- `SHA256SUMS.txt.asc` is clear-signed by **Ava Chow, RSA-4096 `1528 1230 0785 C964 44D3 334D 1756 5732 E08E 5E41`** (expires 2027-08-21). Verified on 2026-10-21 with the key from [bitcoin-core/guix.sigs](https://github.com/bitcoin-core/guix.sigs/blob/main/builder-keys/achow101.gpg); signature made 2026-02-10.
- Hashes:

| File | SHA-256 |
|---|---|
| ZIP | `2f1a5574647e3ce11b1a05feab2fcbbf17061937c970d321d7f4c28a7b6eca23` |
| `hwi.exe` | `e068d91b664597425a8ead02d7b86a02ad6c4b72746c42961f58a58b08f9fd79` |
| `hwi-qt.exe` | `10300209bb1fb27a9c9eb1804ae4414de534c2028d55a57d8618835ba6822a9f` |

- Python package: `hwi` on PyPI, Python `>=3.9,<3.13`, MIT ([pyproject.toml](https://github.com/bitcoin-core/HWI/blob/3.2.0/pyproject.toml)).

### 5.2 Status and successors

- [Issue #850](https://github.com/bitcoin-core/HWI/issues/850) (2026-08-18, pinned):
  - "The current plan is to finish the MuSig2 feature, then formally enter a minimal maintenance mode."
  - No new features or devices.
  - The next release "will likely be the final release of HWI".
  - The repository is to be archived once a replacement exists.
- Successor candidates:
  - **BHWI** (`bhwi`; Wizardsardine, Rust, sans-I/O). It ships a Python-HWI-compatible `hwi` binary but has no releases.
  - Wizardsardine's **async-hwi** (used by Liana).
  - Sparrow's **Lark** (Java, embedded in Sparrow).
- Unreleased on master: `registerdescriptor`, plus `--registration` for `signtx` and `displayaddress` (BIP388 policies), and COLDCARD EDGE/Taproot display (PR #849).

### 5.3 Devices (3.2.0)

Combined from the [support matrix](https://hwi.readthedocs.io/en/latest/devices/index.html), the device drivers and the hardware notes below:

| Device | Model strings | Notes |
|---|---|---|
| Ledger Nano S, Nano X, Nano S Plus, Stax, Flex | `ledger_nano_s`, `ledger_nano_x`, `ledger_nano_s_plus`, `ledger_stax`, `ledger_flex` | Bitcoin app must be open; app ≥ 2.1.0 uses the new protocol; multisig registered during `signtx` when the PSBT carries global xpubs; Nano Gen5 only on master |
| Trezor One, Model T, Safe 3, Safe 5 | `trezor_` + the lower-cased `features.model` (for example `trezor_1`, `trezor_t`) | No Bridge needed; non-wallet inputs removed (1.10.6+/2.4.4+); no descriptor registration; **Safe 7 unsupported** (THP) |
| BitBox02, BitBox02 Nova | `bitbox02_multi`, `bitbox02_btconly`, `bitbox02_nova_multi`, `bitbox02_nova_btconly` | No P2PKH or P2SH (non-SegWit) multisig; pairing must be done in the BitBoxApp first when HWI runs non-interactively |
| Coldcard | — | Cannot be set up/wiped/recovered through software; Taproot not marked supported in the matrix |
| Jade, Jade Plus | — | USB serial; unlock may involve the PIN server (below); Taproot not supported in the matrix; Jade Core untested |
| KeepKey | — | No Taproot |
| BitBox01 | — | End-of-life device; driver still present |

The published matrix is partly outdated (for example BitBox02 Taproot works in the driver).

### 5.4 Commands BTCortex may use

| Command (3.2.0) | BTCortex use | User interaction |
|---|---|---|
| `enumerate` | Discovery on request (type, model, path, label, fingerprint, `needs_pin_sent`, `needs_passphrase_sent`, `error`, `code`; **no firmware version**) | Device may need unlocking |
| `getdescriptors --account N` | Watch-only import (receive and internal descriptors for supported address types, with key origins) | Usually none |
| `getxpub <path>`, `getmasterxpub --addr-type …` | Key import for coordinators | Some devices confirm non-standard paths |
| `getkeypool` | Avoid; `getdescriptors` is simpler | — |
| `displayaddress --desc <descriptor>` | Address verification before first use | User compares on the device |
| `signtx` (via `--stdin`) | **Only after an explicit user action**; PSBT reviewed in BTCortex first | User confirms on the device |
| `signmessage` | Not exposed by default | User confirms |
| `promptpin`, `sendpin` | Not exposed; unlock in the vendor app or on the device | — |
| `togglepassphrase`, `--password`, `--stdinpass` | **Never** (BIP39 passphrase handling belongs to wallets) | — |
| `setup`, `wipe`, `restore`, `backup` | **Never** (seed management) | — |
| `installudevrules` | Linux only; not applicable | — |

Practicalities:

- Output is JSON on stdout; prompts and debug output go to stderr. Errors are objects with `error` and `code`.
- Use `--chain main|test|signet|regtest|testnet4` to match the node.
- Pass PSBTs with `--stdin` (as Bitcoin Core does: `hwi --stdin --fingerprint <fpr> --chain <chain>` followed by `signtx <base64>`), because Windows command lines are limited to about 32 KB.
- Give read-only calls a timeout. Calls that wait for the device need a visible cancel button and no silent retry.

### 5.5 Bitcoin Core external signer

- Bitcoin Core can call HWI itself: `-signer=<path to hwi.exe>`, a wallet created with `external_signer=true` (and private keys disabled), and the RPCs `enumeratesigners`, `walletdisplayaddress` and `send` ([external-signer.md](https://github.com/bitcoin/bitcoin/blob/v31.1/doc/external-signer.md)).
- 31.1 runs `<cmd> enumerate`, `<cmd> --fingerprint <fpr> --chain <chain> getdescriptors --account <n>`, `… displayaddress --desc <descriptor>` and `<cmd> --stdin --fingerprint <fpr> --chain <chain>` with `signtx <base64>` on standard input ([external_signer.cpp](https://github.com/bitcoin/bitcoin/blob/v31.1/src/external_signer.cpp)). The documentation requires HWI 2.0 or newer.
- `ENABLE_EXTERNAL_SIGNER` defaults to ON in 31.1's CMake (only fuzz builds turn it off); whether the official Windows binaries include it was not verified.
- This path keeps signing inside Core's wallet logic. It is a reasonable alternative to BTCortex calling HWI directly for single-signature watch-only wallets.

### 5.6 Network behaviour (Jade)

- HWI's Jade client relays the PIN-server exchange to Blockstream's server over **clearnet HTTPS** (it picks "the first non-onion url") when Python's `requests` module is available ([jadepy/jade.py](https://github.com/bitcoin-core/HWI/blob/3.2.0/hwilib/devices/jadepy/jade.py)).
- Otherwise it asks the user to use "QR PIN Unlock" or "Recovery Phrase Login" on the device ([jade.py](https://github.com/bitcoin-core/HWI/blob/3.2.0/hwilib/devices/jade.py)).
- Whether the Windows binary bundles `requests` was not checked.
- In privacy profiles, unlock Jade in Sparrow or the Blockstream App (which can use Tor) before using HWI.

### 5.7 Sparrow, HWI or vendor SDKs?

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **Delegate to Sparrow** | One mature UI owns device registration, address verification, PSBT review and signing; supports USB (Lark, including the Trezor Safe 7), QR (UR, BBQr), microSD and smartcards; actively maintained | No API: BTCortex only hands over PSBT files and watch-only data | **Default** for signing and multisig |
| **HWI CLI** | Narrow JSON interface, Bitcoin Core's own reference signer, signed portable binary, no drivers, no network (except Jade unlock) | Winding down; no Safe 7 or Nano Gen5; uneven multisig/policy support; device contention | Use for discovery, watch-only import, address display and explicit single-signature signing, behind an adapter |
| **Vendor SDKs** (Trezor Connect/THP, ledger-bitcoin, BitBox02 Noise, Jade CBOR) | Newest features | Several stacks to maintain and audit, WebHID/WebUSB inside WebView2 widens the attack surface, and the specification forbids claiming SDK support without verification | Not recommended for Phase 5 |

---

## 6. Wallet connection wizard flows (spec section 8)

The wizard must identify the components, validate compatibility and configure only what is safe. Common pre-checks for every flow:

- the node's chain and network (refuse Bitcoin Knots ≥ 29.4.1 unless the user explicitly chose that chain);
- RPC reachability on loopback;
- whether the wallet is enabled;
- initial-block-download state;
- pruning and prune height;
- the indexes required by the flow;
- the target application's version;
- whether the application is running.

### 6.1 Bitcoin Core → Fulcrum → Sparrow (Profile B; needs an unpruned node)

| Step | Who | Action | Safe to automate |
|---|---|---|---|
| 1 | BTCortex | Node: `prune=0`, `txindex=1`, `zmqpubhashblock`; wait for `getindexinfo` txindex `synced=true` (electrum-indexers-explorers notes §3) | Yes, after the plan is approved |
| 2 | BTCortex | Fulcrum on `127.0.0.1:50001`/`50002` with a long-lived self-signed certificate; wait until its client ports are bound (only after initial sync) | Yes |
| 3 | BTCortex | Sparrow closed: merge `serverType: "ELECTRUM_SERVER"`, `electrumServer: "ssl://127.0.0.1:50002\|BTCortex Fulcrum"`, `electrumServerCert: "<…\\fulcrum\\cert.pem>"`, `useProxy: false`, optionally `mode: "ONLINE"` | Yes, only while closed; ask before replacing user-chosen servers |
| 4 | BTCortex | Launch `Sparrow.exe -n mainnet`; health: Fulcrum `server.version`, Sparrow log | Yes |
| 5 | User | Create or import the wallet (hardware or watch-only); verify addresses on the device | No |
| 6 | User | Build, review and sign PSBTs; broadcast | No, always explicit |

The same Fulcrum endpoint serves `electrum` (`--oneserver --server 127.0.0.1:50002:s --serverfingerprint <sha256>`), `bitboxapp` (`config.json` while closed), `trezor-suite` (user pastes `127.0.0.1:50002:s`) and `blockstream-app` (single-signature only).

### 6.2 Bitcoin Core (pruned) → Sparrow directly — exact pre-configuration recipe

**Node side** (BTCortex-managed `bitcoin-core` 31.1):

- `server=1`; RPC on loopback with cookie authentication (default).
- Wallet enabled: no `disablewallet=1`, never start with `-disablewallet`/`-nowallet`.
- `prune=<MiB>` from the hardware-aware formula (test machine: about 24000).
- Optionally `blockfilterindex=1` (Core 25+, compatible with pruning; extra disk) for faster rescans.
- Initial block download must have finished before the wallet flow is offered, otherwise Sparrow waits.
- Core and Sparrow run as the **same Windows user** so Sparrow can read `.cookie`.

**Sparrow side — conditions before writing:**

1. No `Sparrow.exe` process for this user, and `sparrow.lock` in the target network folder does not answer (a stale file is harmless).
2. No `network-testnet`, `network-testnet4` or `network-signet` marker file contradicts the target network.
3. If a config exists, read it and stop to ask the user if `serverType`, `coreServer` or `electrumServer` are already set to something else.
4. Back up the existing file, merge only the keys below, keep all other keys, write to a temporary file and rename.

**File:** `%APPDATA%\Sparrow\config` (mainnet). Test networks use `%APPDATA%\Sparrow\testnet3\config`, `…\testnet4\config`, `…\signet\config` or `…\regtest\config`, with `coreServer` ports 18332, 48332, 38332 or 18443. `coreDataDir` always points at the root data directory; Sparrow appends `testnet3\`, `testnet4\`, `signet\` or `regtest\` for the cookie.

```json
{
  "mode": "ONLINE",
  "serverType": "BITCOIN_CORE",
  "coreServer": "http://127.0.0.1:8332",
  "coreAuthType": "COOKIE",
  "coreDataDir": "C:\\Users\\<user>\\AppData\\Local\\Bitcoin",
  "useLegacyCoreWallet": false,
  "useProxy": false
}
```

- `mode` is written only if the user approved "connect Sparrow to my node" in the plan; otherwise omit it and Sparrow's Welcome flow opens the server settings with these values pre-filled.
- `coreDataDir` must be the managed node's actual data directory (`%LOCALAPPDATA%\Bitcoin` is the Core 28+ default; an existing `%APPDATA%\Bitcoin` or a custom `-datadir` takes precedence).
- Do not write `coreAuth` for local nodes.

**Launch:** `Sparrow.exe -n mainnet` from the verified ZIP folder.

**What happens:**

1. Cormorant checks Core ≥ 24 and waits for synchronisation.
2. It loads or creates the `cormorant` wallet (`load_on_startup=true`, so it is added to Core's `settings.json`).
3. When the user creates or imports a wallet, it imports the descriptors.
4. If the wallet birthday precedes the prune date, Sparrow shows "Wallet birthday earlier than Bitcoin Core prune date".

**Post-conditions BTCortex enforces:**

- `cormorant` stays loaded at every node start.
- BTCortex never calls `unloadwallet`, `importdescriptors` or `rescanblockchain` on it.
- Read-only monitoring is allowed: `listwallets`, and `getwalletinfo` for the scanning status.
- A node data-directory move or re-sync requires re-pointing `coreDataDir` while Sparrow is closed.

**What to tell the user:** new wallets work immediately. An existing wallet (for example from the installed Electrum) can only be found if its history is newer than the prune date. Otherwise the options are an archival node, a remote Electrum server, or moving funds to a new wallet created after the node synced.

### 6.3 Bitcoin Core → Specter Desktop → hardware wallet

See §7.1 for details and sources. Summary of what is safe:

| Step | Who | What | Safe to automate |
|---|---|---|---|
| 1 | BTCortex | Node with RPC and wallets enabled; cookie; network expressed in `bitcoin.conf` as `testnet=1`/`signet=1`/`regtest=1` (Specter ignores `chain=` and flags); no testnet4 | Yes |
| 2 | BTCortex | Verify (pinned `9DC3 3CA8 3058 9DE3 B322 5C26 EEF5 756B 2EA4 2349`) and extract `specterd-<v>-win64.zip`; run `specterd.exe server --host 127.0.0.1 --port 25441 --no-filelog` | Yes |
| 3 | BTCortex | With specterd stopped: write `%USERPROFILE%\.specter\nodes\btcortex_core.json` (autodetect, explicit `datadir`) and `active_node_alias` in `config.json`; optional `tor_type: "custom"`, `proxy_url` | Yes, only while stopped |
| 4 | BTCortex | Recommend enabling Specter authentication (`auth.method` is `"none"` by default) | Suggest only |
| 5 | User | Add the device (USB through Specter's bundled HWI 3.1.0, or QR/SD) | No |
| 6 | User | Create the single-signature or multisig wallet (Specter creates `specter/<alias>` in Core with `importdescriptors`, timestamp "now") | No |
| 7 | BTCortex | Keep the new Core wallet loaded at start (`wallet=specter/<alias>` in `bitcoin.conf`), asking once; Specter does not set `load_on_startup` | Yes, after asking |
| 8 | User | Verify addresses on the device; create, sign and broadcast PSBTs | No |

Never create Specter's "Bitcoin Core (hot wallet)" device. Upstream does not test Core 30/31: BTCortex must run its own integration test before marking the flow supported. On a pruned node only new wallets work.

### 6.4 Other flows

| Flow | Pre-configuration | Notes |
|---|---|---|
| Bitcoin Core → HWI → Core watch-only (BTCortex-native) | `hwi getdescriptors` → user confirms fingerprint and descriptors → `createwallet <name> disable_private_keys=true blank=true descriptors=true load_on_startup=true` → `importdescriptors` (timestamp ≥ prune height); PSBT: `walletcreatefundedpsbt` → review → `hwi --stdin signtx` → `finalizepsbt` → explicit `sendrawtransaction` | Works on the pruned test machine; label the wallet watch-only |
| Bitcoin Core (pruned) → Wasabi | Launch `wassabee.exe --network=main --bitcoinrpcendpoint=http://127.0.0.1:8332 --bitcoinrpccredentialstring=<credentials> --downloadnewversion=false`; node `blockfilterindex=1` | Cookie format `cookiefile=<path>` untested: a dedicated `rpcauth` user is the fallback; never choose a coordinator |
| Bitcoin Core (pruned) → Liana | User runs Liana's installer; BTCortex supplies `addr = '127.0.0.1:8332'` and the exact cookie path (`…\AppData\Local\Bitcoin\.cookie`); never let Liana download its own Core | No Tor; hot-signer mnemonic files must never be touched |
| Bitcoin Core (pruned) → Nunchuk | Dedicated `rpcauth` user (no cookie support); `wallet=nunchuk` in `bitcoin.conf`; values shown for the user to enter (registry keys undocumented) | Default Electrum server is Nunchuk's |
| Bitcoin Core → Caravan | Local build or Docker image, loopback CORS proxy, `rpcauth` user with an `rpcwhitelist`, watch-only wallet `watcher` | Later step; external-launcher for now |
| Bitcoin-Safe | Nothing by default (compact block filters); optional proxy | Own node as filter peer needs `listen=1` |
| Fulcrum → Electrum | Command-line flags (§4.3) | Pin to 4.8.x while Fulcrum lacks protocol 1.7 |

### 6.5 What BTCortex may and may not configure

| May configure (with the application closed where relevant) | Must leave to the user or the application |
|---|---|
| Back-end endpoints, authentication type, cookie path, certificate pinning, proxy/Tor settings, network selection, update-check switches, launch arguments | Creating, restoring or importing wallets; any seed, passphrase or private key; hot-wallet devices (Specter "Bitcoin Core (hot wallet)", Liana hot signers, Sparrow software wallets) |
| Node-side settings the flow needs (`server`, wallet enabled, `blockfilterindex`, `txindex` when unpruned, `wallet=<name>` lines to keep watch-only wallets loaded) | Accepting terms of use (Electrum `terms_of_use_accepted`, Blockstream `accepted_tos_version`) |
| Installing, verifying, updating and removing the application binaries | Choosing a CoinJoin coordinator (Wasabi) or a public server; enabling vendor AI/MCP servers (Trezor Suite) |
| Handing PSBT files to an application for review | Registering multisig or policies on devices, signing, broadcasting, message signing |
| Reading non-secret configuration keys for diagnostics | Reading wallet files, label databases or logs beyond the lines needed for diagnostics |

---

## 7. Other desktop wallets and multisig coordinators

Details for the remaining wallet and coordinator entries. The wizard flows that use them are summarised in §6; the matrices in §2 compare them.

### 7.1 Specter Desktop (`specter-desktop`)

#### Facts at a glance

| Item | Value |
|---|---|
| Latest stable | **2.1.11**, published 2026-08-09 ([release](https://github.com/cryptoadvance/specter-desktop/releases/tag/v2.1.11)); prerelease 2.2.0-pre5 on 2026-08-15 ([tags feed](https://github.com/cryptoadvance/specter-desktop/tags.atom)) |
| Maintenance | **Active** but mostly upkeep: 2.1.7 (April 2026) to 2.1.11 were dependency, CI (move to GitHub Actions) and security releases; last master commit 2026-09-03; repository not archived, 253 open issues ([API](https://api.github.com/repos/cryptoadvance/specter-desktop)). No maintenance-mode announcement found. The documentation's [release notes](https://raw.githubusercontent.com/cryptoadvance/specter-desktop/master/docs/release-notes.md) stop at 2.1.0 (2025-01-03) |
| Windows | x64 only: `Specter-Setup-v2.1.11.exe` (Electron GUI that bundles the server) and `specterd-v2.1.11-win64.zip` (server only) |
| Verification | `SHA256SUMS` + `SHA256SUMS.asc`, "Specter Signer 2026" key `9DC3 3CA8 3058 9DE3 B322 5C26 EEF5 756B 2EA4 2349`, itself signed by k9ert's key |
| Back ends | Bitcoin Core RPC; Electrum server through the bundled **Spectrum** adapter |
| Hardware | HWI 3.1.0 bundled (USB), QR signers, SD-card signers |
| Licence | MIT |
| Recommended level | `connected-application`, P2 |

#### Windows distribution and unattended installation

- `Specter-Setup-vX.exe` is an electron-builder NSIS installer. Its [package.json](https://raw.githubusercontent.com/cryptoadvance/specter-desktop/master/pyinstaller/electron/package.json) sets only an icon for Windows, so electron-builder's defaults apply: `oneClick` true and `perMachine` false, i.e. a one-click **per-user** installation without elevation ([nsisOptions](https://unpkg.com/app-builder-lib@26.15.3/out/targets/nsis/nsisOptions.d.ts)). The NSIS `/S` silent switch is the usual convention but was not tested. The build has no Windows signing settings, so expect unsigned binaries and SmartScreen prompts (not checked).
- The Electron shell looks for `specterd.exe` next to it. If the binary is missing or its SHA-256 differs from the hash pinned in the app, it downloads `https://github.com/cryptoadvance/specter-desktop/releases/download/<version>/specterd-<version>-win64.zip`, checks the extracted binary against that pinned hash (no OpenPGP) and starts it as `specterd server --no-filelog` plus `specterdCLIArgs` ([main.js](https://raw.githubusercontent.com/cryptoadvance/specter-desktop/master/pyinstaller/electron/main.js), [download.js](https://raw.githubusercontent.com/cryptoadvance/specter-desktop/master/pyinstaller/electron/src/download.js), [downloadloc.js](https://raw.githubusercontent.com/cryptoadvance/specter-desktop/master/pyinstaller/electron/downloadloc.js), [specterd.js](https://raw.githubusercontent.com/cryptoadvance/specter-desktop/master/pyinstaller/electron/src/specterd.js)). Readiness is detected by the string "Serving Flask app" within 180 s. On Windows it stops specterd with `taskkill /F /T`.
- **Preferred zero-touch form for BTCortex:** verify and extract `specterd-vX-win64.zip` into a per-user versioned folder, run `specterd.exe server --host 127.0.0.1 --port 25441 --no-filelog` as a supervised child process and open `http://127.0.0.1:25441` in the browser. No installer, no elevation, no Electron.

#### Verification

`SHA256SUMS` lists all binaries and is signed with the "Specter Signer 2026" key, fingerprint `9DC33CA830589DE3B3225C26EEF5756B2EA42349`, published on keyserver.ubuntu.com and "signed by @k9ert's key" ([v2.1.11](https://github.com/cryptoadvance/specter-desktop/releases/tag/v2.1.11), [v2.2.0-pre5](https://api.github.com/repos/cryptoadvance/specter-desktop/releases/tags/v2.2.0-pre5)). Pin the fingerprint; expect a key rotation per year (the name suggests it).

#### Data folder and configuration on Windows

The data folder is `%USERPROFILE%\.specter` (`~/.specter`, override with `SPECTER_DATA_FOLDER`, `--specter-data-folder`, or `SPECTER_CONFIG` for another config class; the default class is `ProductionConfig`) ([config.py](https://raw.githubusercontent.com/cryptoadvance/specter-desktop/master/src/cryptoadvance/specter/config.py), [server.py](https://raw.githubusercontent.com/cryptoadvance/specter-desktop/master/src/cryptoadvance/specter/server.py)).

| File | Content |
|---|---|
| `config.json` | Global settings. Defaults ([config_manager.py](https://raw.githubusercontent.com/cryptoadvance/specter-desktop/master/src/cryptoadvance/specter/managers/config_manager.py)): `auth` (`method` `"none"`), `explorers`, `explorer_id`, `active_node_alias` (null), `proxy_url` `"socks5h://localhost:9050"`, `only_tor` false, `tor_control_port` `""`, `tor_status` false, `hwi_bridge_url` `"/hwi/api/"`, `fee_estimator` `"bitcoin_core"`, `price_check` false, `validate_merkle_proofs` false, `autologout_timeout_hours` 4, and others. `tor_type` (`"builtin"`, `"custom"`, `"disabled"`) is added when Tor is configured ([settings.py](https://raw.githubusercontent.com/cryptoadvance/specter-desktop/master/src/cryptoadvance/specter/server_endpoints/settings.py)) |
| `nodes\<alias>.json` | One file per node ([node_manager.py](https://raw.githubusercontent.com/cryptoadvance/specter-desktop/master/src/cryptoadvance/specter/managers/node_manager.py), [node.py](https://raw.githubusercontent.com/cryptoadvance/specter-desktop/master/src/cryptoadvance/specter/node.py), [persistence.py](https://raw.githubusercontent.com/cryptoadvance/specter-desktop/master/src/cryptoadvance/specter/persistence.py)) |
| `sqlite\db.sqlite` | Spectrum (Electrum adapter) cache ([service.py](https://raw.githubusercontent.com/cryptoadvance/specter-desktop/master/src/cryptoadvance/specterext/spectrum/service.py)) |
| `app_settings.json` | Electron shell: `mode` (`"specterd"`), `specterURL`, `basicAuth*`, `tor`, `proxyURL`, `specterdVersion`, `specterdHash`, `specterdCLIArgs`, `versionInitialized` ([config.js](https://raw.githubusercontent.com/cryptoadvance/specter-desktop/master/pyinstaller/electron/src/config.js)) |
| `specterApp.log`, `.tor_service_key`, `onion.txt`, `tor-binaries\` | Log, hidden-service key, onion address, built-in Tor |

Example node file that BTCortex can write (keys from `Node.json` plus the `python_class` that `PersistentObject.from_json` requires):

```json
{
  "python_class": "cryptoadvance.specter.node.Node",
  "name": "BTCortex Bitcoin Core",
  "alias": "btcortex_core",
  "autodetect": true,
  "datadir": "C:\\Users\\<user>\\AppData\\Local\\Bitcoin",
  "user": "",
  "password": "",
  "port": 8332,
  "host": "localhost",
  "protocol": "http",
  "node_type": "BTC",
  "fullpath": "C:\\Users\\<user>\\.specter\\nodes\\btcortex_core.json"
}
```

Then set `"active_node_alias": "btcortex_core"` in `config.json`. Whether `port` is stored as a number or a string was not checked.

**Autodetect rules** ([rpc.py](https://raw.githubusercontent.com/cryptoadvance/specter-desktop/master/src/cryptoadvance/specter/rpc.py)): reads `rpcuser`, `rpcpassword`, `rpcconnect` and `rpcport` from `bitcoin.conf` in `datadir` (`[default]` plus the network section); chooses the network from `regtest=1`, `testnet=1` or `signet=1` (otherwise main); reads `.cookie` from the data directory root or the `testnet3`, `regtest` or `signet` subfolder; tests each candidate with `getmininginfo`. Autodetect is re-run on every RPC connection, so cookie rotation at node restart is handled. The built-in Windows default is **`%APPDATA%\Bitcoin` only** (marked "Not tested yet!" in the code), so `datadir` must always be written explicitly for Core 28+ installations in `%LOCALAPPDATA%\Bitcoin`.

**Alternative (2.1.7+):** start specterd once with `BTC_RPC_USER`, `BTC_RPC_PASSWORD`, `BTC_RPC_HOST`, `BTC_RPC_PORT`, `BTC_RPC_PROTOCOL`; on a fresh install with no nodes it creates an external node "Bitcoin Core" with autodetect off ([v2.1.7](https://github.com/cryptoadvance/specter-desktop/releases/tag/v2.1.7), node_manager.py). This needs a dedicated `rpcauth` user and stores its password in plain text.

**When it is safe:** only while specterd and the Electron app are stopped. Specter rewrites `config.json` at start-up (`check_config` → `_save()`), and its JSON writes are not atomic: the old file is renamed to `.bkp`, the new one written and re-read, with only an in-process lock ([persistence.py](https://raw.githubusercontent.com/cryptoadvance/specter-desktop/master/src/cryptoadvance/specter/persistence.py)).

#### Command-line flags

`specterd.exe server` with `--host` (default 127.0.0.1), `--port` (25441), `--cert`/`--key`, `--ssl/--no-ssl`, `--debug/--no-debug`, `--filelog/--no-filelog`, `--tor`, `--hwibridge`, `--skiphwiinitialisation`, `--devstatus-threshold alpha|beta|prod`, `--specter-data-folder`, `--config` ([cli_server.py](https://raw.githubusercontent.com/cryptoadvance/specter-desktop/master/src/cryptoadvance/specter/cli/cli_server.py)). There is no network flag: the network comes from the node.

#### Back ends

- **Bitcoin Core**: per Specter wallet a watch-only descriptor wallet `specter/<alias>` is created with `createwallet(name, true, true, "", false, true)` (disable_private_keys, blank, passphrase, avoid_reuse, descriptors) when Core ≥ 0.21, and descriptors are imported with `importdescriptors` (timestamp `"now"`, watch-only). `importmulti` is only the fallback for Core < 0.21 ([wallet.py](https://raw.githubusercontent.com/cryptoadvance/specter-desktop/master/src/cryptoadvance/specter/wallet/wallet.py)). None of these RPCs was removed in Core 30.0. `load_on_startup` is **not** passed, so Core does not load Specter's wallets at start-up.
- **Electrum server** through Spectrum (`cryptoadvance.spectrum==0.8.0`, [requirements.in](https://raw.githubusercontent.com/cryptoadvance/specter-desktop/master/requirements.in)): node alias `spectrum_node`, persisted keys `host`, `port`, `ssl` ([spectrum_node.py](https://raw.githubusercontent.com/cryptoadvance/specter-desktop/master/src/cryptoadvance/specterext/spectrum/spectrum_node.py)); uses Specter's proxy when Tor is configured. The [Spectrum README](https://raw.githubusercontent.com/cryptoadvance/spectrum/master/README.md) lists open gaps (no reconnection after a disconnect, keypool not refilled).
- **No managed node**: "Since version 2.0 we no longer support a Bitcoin Core node managed by the Specter app" ([FAQ](https://docs.specter.solutions/desktop/faq/)).

#### Tor

`tor_type` `"custom"` with `proxy_url` `socks5h://127.0.0.1:9050`, `tor_control_port` (for a hidden service with a control port) and `only_tor`. `"builtin"` makes Specter install and run its own Tor under `tor-binaries\`; BTCortex should use `"custom"` with its own Tor ([Tor docs](https://docs.specter.solutions/desktop/tor/), [settings.py](https://raw.githubusercontent.com/cryptoadvance/specter-desktop/master/src/cryptoadvance/specter/server_endpoints/settings.py)). The FAQ says the hidden-service mode is not supported in 2.0, yet `--tor` still starts one in the 2.1.x server code.

#### Hardware wallets, PSBT, QR, SD

- Device classes ([devices/\_\_init\_\_.py](https://raw.githubusercontent.com/cryptoadvance/specter-desktop/master/src/cryptoadvance/specter/devices/__init__.py)): ColdCard, Trezor, Ledger, BitBox02, Specter (DIY), Keepkey, Keystone, Cobo, Passport, Jade, SeedSignerDevice, BitcoinCore, BitcoinCoreWatchOnly, ElementsCore, KeycardShell, GenericDevice.
- USB through HWI **3.1.0** (bumped from 2.4.0 in 2.1.10). Jade Plus and BitBox02 Nova support arrived in HWI 3.2.0, so their USB detection in Specter is uncertain.
- QR through the browser (for example SeedSigner: animated, 2 frames per second, Taproot, message signing — [seedsigner.py](https://raw.githubusercontent.com/cryptoadvance/specter-desktop/master/src/cryptoadvance/specter/devices/seedsigner.py)); SD-card devices through `sd_card_device.py`.
- **Danger:** the "Bitcoin Core (hot wallet)" device takes a mnemonic and imports xprv descriptors into a Core wallet under `_hotstorage` ([bitcoin_core.py](https://raw.githubusercontent.com/cryptoadvance/specter-desktop/master/src/cryptoadvance/specter/devices/bitcoin_core.py)). BTCortex must never create or suggest it.

#### Multisig, miniscript, BIP329

Multisig with nested and native SegWit only (FAQ). No miniscript wallets found; the timelock-recovery extension uses presigned transactions instead. BIP329 import/export is an **open pull request** (#2712, 2026-09-11), not released ([search](https://api.github.com/search/issues?q=repo:cryptoadvance/specter-desktop+bip329+OR+miniscript+OR+%22BIP-329%22+OR+%22bip-0329%22&per_page=10)). testnet4 is unsupported (#2516 open).

#### Bitcoin Core → Specter Desktop → hardware wallet flow

| Step | Who | What | Safe to automate? |
|---|---|---|---|
| 1 | BTCortex | Node with RPC and **wallets enabled** (`disablewallet=0`); cookie authentication; network expressed in `bitcoin.conf` as `testnet=1`/`signet=1`/`regtest=1` (Specter does not read `chain=` or command-line flags); mainnet, testnet3, signet or regtest only | Yes |
| 2 | BTCortex | Download, verify (pinned fingerprint) and extract specterd; start it on 127.0.0.1:25441 | Yes |
| 3 | BTCortex | With specterd stopped: write `nodes\btcortex_core.json` (autodetect, explicit `datadir`) and `active_node_alias`; optionally `tor_type` `"custom"`, `proxy_url`, `only_tor` | Yes, only while stopped |
| 4 | BTCortex | Recommend enabling authentication (`auth.method` is `"none"` by default) | Suggest only (the user chooses the password) |
| 5 | User | Add a device: USB through HWI (xpub export confirmed on the device) or QR/SD import | No: user action and device confirmation |
| 6 | User | Create a single-signature or multisig wallet; Specter creates `specter\<alias>` in Core and imports descriptors with timestamp "now" | No |
| 7 | BTCortex | Keep the new wallet loaded when Core starts (`wallet=specter/<alias>` in `bitcoin.conf`, or a reload with `load_on_startup=true`). Specter creates wallets without `load_on_startup`; on a **pruned** node, Core would otherwise prune blocks that the unloaded wallet never saw | Yes, after asking once |
| 8 | User | Verify receive addresses on the device; create a PSBT in Specter; sign on the device (USB, QR or SD); broadcast explicitly | No: always explicit |

**Core 31.1**: no upstream statement. The descriptor path uses no RPC removed in 30.0 and an issue reporter ran Specter 2.1.8 with Core 30.2 ([#2624](https://api.github.com/search/issues?q=repo:cryptoadvance/specter-desktop+%22Core+30%22+OR+%22v30%22+OR+%22legacy+wallet%22+OR+importmulti&per_page=15)), but upstream CI tests bitcoind 27.2.0. BTCortex must cover this combination in its own integration tests before claiming support. Old Specter wallets created as legacy (BDB) wallets cannot be loaded by Core 30+ until migrated with Core's `migratewallet`.

**Pruned node**: new wallets work because the import uses timestamp "now". Restoring a wallet with history cannot rescan below the prune height. Specter's UTXO-only scan works on pruned nodes but fetches transaction data from a user-configured block explorer ([FAQ](https://docs.specter.solutions/desktop/faq/)), which leaks addresses unless the explorer is self-hosted (not possible on the test machine).

#### Pitfalls

- `%APPDATA%\Bitcoin` hard-coded as the Windows default data directory (Core 28+ uses `%LOCALAPPDATA%\Bitcoin`).
- Specter's Core wallets are not loaded at node start-up (pruning hazard, step 7).
- Network detection only through `testnet=1`/`signet=1`/`regtest=1` in `bitcoin.conf`; no testnet4.
- Issue #1770: Windows Specter with a remote Linux node mixes path separators in wallet paths.
- The Windows guide in the docs targets pip installs (Python 3.9 from the Store, copying libusb DLLs into `System32`); BTCortex must not follow it.
- Two installs (Electron per-user and a specterd ZIP) would share `%USERPROFILE%\.specter`; never run both at once.

#### Security

Authentication off by default; the data folder (node passwords, xpubs, labels) is not encrypted at rest (warning since 2.1.11). 2026 fixes: open-redirect bypass and default-secret-key warning (2.1.7), HWI bridge auth and CSRF, API token validation and a ColdCard Mk3 seed-entropy advisory warning (2.1.11) ([releases feed](https://github.com/cryptoadvance/specter-desktop/releases.atom)). Keep the UI on loopback.

### 7.2 Liana (`liana`)

#### Facts at a glance

| Item | Value |
|---|---|
| Latest stable | **15.0**, 2026-08-01 ([release](https://github.com/wizardsardine/liana/releases/tag/v15.0)); Liana Business 1.0rc2 the same day ([feed](https://github.com/wizardsardine/liana/releases.atom)) |
| Maintenance | Active: 14.0 (2026-04-17), 13.1 (2025-10-09); commits on 2026-10-16 ([commits](https://github.com/wizardsardine/liana/commits/master)) |
| Windows | `liana-15.0.exe`, x64, standalone GUI executable, not code-signed ([USAGE.md](https://raw.githubusercontent.com/wizardsardine/liana/master/doc/USAGE.md)) |
| Verification | `liana-15.0-shasums.txt` + `.asc`; USAGE.md names Edouard Paris's key `5B63F3B97699C7EEF3B040B19B7F629A53E77B83` |
| Back ends | Bitcoin Core (existing or Liana-managed), Electrum server, Liana Connect (hosted) |
| Pruned node | **Supported** (rescans limited to the prune height) |
| Tor | **None** |
| Licence | BSD-3-Clause ([LICENCE](https://raw.githubusercontent.com/wizardsardine/liana/master/LICENCE)) |
| Recommended level | `connected-application`, P2 |

#### Windows distribution and unattended installation

[`contrib/release/release.sh`](https://raw.githubusercontent.com/wizardsardine/liana/master/contrib/release/release.sh) copies the Nix-built `x86_64-pc-windows-gnu/liana-gui.exe` into the release, so the Windows asset is the GUI itself: no installer, no elevation, no registry entries. BTCortex verifies the shasums signature and the SHA-256, stores the executable in a per-user versioned folder and creates a shortcut. Updating means replacing the executable; data stays in `%APPDATA%\Liana`. The v15.0 notes say Windows builds are reproducible again after stripping the COFF symbol table. The GitHub tag itself is signed with a different, expired key (ID `E65F7A089C20DC8F`); the key that signed `liana-15.0-shasums.txt.asc` was not checked.

#### Data directory and configuration on Windows

Root `%APPDATA%\Liana` (`dirs::config_dir()` + `Liana`; `~/.liana` on Linux) ([dir.rs](https://raw.githubusercontent.com/wizardsardine/liana/master/liana-gui/src/dir.rs)):

```text
%APPDATA%\Liana\
  bitcoind\                         managed Bitcoin Core (binaries + datadir\, own bitcoin.conf)
  <network>\                        bitcoin | testnet | testnet4 | signet | regtest
    settings.json                   wallets[]: name, alias, descriptor_checksum, pinned_at, keys,
                                    hardware_wallets, remote_backend_auth, start_internal_bitcoind, fiat_price
    gui.toml                        log_level, debug, (legacy) start_internal_bitcoind
    <mnemonics folder>\mnemonic-*.txt   hot-signer mnemonics (never touch)
    data\<wallet id>\
      daemon.toml                   per-wallet daemon configuration (written by the installer)
      lianad_wallet                 Bitcoin Core watch-only wallet (absolute path)
```

Sources: [settings/mod.rs](https://raw.githubusercontent.com/wizardsardine/liana/master/liana-gui/src/app/settings/mod.rs), [config.rs (GUI)](https://raw.githubusercontent.com/wizardsardine/liana/master/liana-gui/src/app/config.rs), [installer/mod.rs](https://raw.githubusercontent.com/wizardsardine/liana/master/liana-gui/src/installer/mod.rs), [signer.rs](https://raw.githubusercontent.com/wizardsardine/liana/master/liana-gui/src/signer.rs). Network folder names are inferred from rust-bitcoin.

`daemon.toml` keys ([lianad config.rs](https://raw.githubusercontent.com/wizardsardine/liana/master/lianad/src/config.rs), [example](https://raw.githubusercontent.com/wizardsardine/liana/master/contrib/lianad_config_example.toml)); values below are illustrative placeholders:

```toml
data_directory = '...'            # data_dir is the legacy name
log_level = 'info'
main_descriptor = 'wsh(or(pk(A),and_v(v:pkh(B),older(N))))#checksum'

[bitcoin_config]
network = 'bitcoin'
poll_interval_secs = 30

[bitcoind_config]                 # either this section...
addr = '127.0.0.1:8332'           # IP literal and port only
cookie_path = 'C:\Users\<user>\AppData\Local\Bitcoin\.cookie'   # or auth = 'user:password', never both

# [electrum_config]               # ...or this one
# addr = 'ssl://127.0.0.1:50002'  # or tcp://
# validate_domain = false         # needed for self-signed certificates
```

**What BTCortex can pre-configure:** a wallet's `daemon.toml` only exists after the user has run Liana's installer (policy, descriptor backup, device registration). BTCortex can therefore (a) supply the exact cookie path and address during the installer's "existing node" step, and (b) re-wire existing wallets by rewriting `[bitcoind_config]` or `[electrum_config]` while Liana is closed. It cannot create a ready-to-use wallet profile in advance without generating a descriptor, which is the user's decision.

**Pre-fill pitfall:** the installer pre-fills `dirs::config_dir()\Bitcoin\<network>\.cookie`, i.e. `%APPDATA%\Bitcoin\.cookie` ([installer bitcoind step](https://raw.githubusercontent.com/wizardsardine/liana/master/liana-gui/src/installer/step/node/bitcoind.rs)), while Core 28+ defaults to `%LOCALAPPDATA%\Bitcoin`. The installer canonicalises the cookie path, so the node must be running at that moment.

#### Command-line flags

`liana-<v>.exe [--datadir <PATH>] [--bitcoin|--testnet|--testnet4|--signet|--regtest] [-v|--version] [-h|--help]` ([args.rs](https://raw.githubusercontent.com/wizardsardine/liana/master/liana-gui/src/args.rs)). On Linux/macOS also `lianad --conf <liana.toml>` and `liana-cli --conf <file> <command>` over a Unix socket ([API.md](https://raw.githubusercontent.com/wizardsardine/liana/master/doc/API.md)).

#### Back ends

- **Bitcoin Core** ≥ 24.0.1 (Taproot ≥ 26.0, testnet4 ≥ 28.0). Liana creates its watch-only wallet with `createwallet <abs path> true true null false true true` (watchonly, blank, passphrase, avoid_reuse, descriptors, **load_on_startup**: "to make sure the wallet will get updated before the historical blocks are deleted"), imports descriptors with `importdescriptors` and refuses rescans below `pruneheight` ([bitcoin/d/mod.rs](https://raw.githubusercontent.com/wizardsardine/liana/master/lianad/src/bitcoin/d/mod.rs)). Compatible with Core 30/31 by design (descriptor RPCs only). Because the wallet path is absolute inside `%APPDATA%\Liana`, the node must be able to write there: same machine and user (a node in WSL2 or Docker would not work without path mapping; not tested).
- **Managed bitcoind**: v15.0 downloads **Bitcoin Core 29.0** from bitcoincore.org with a pinned per-platform SHA-256 ([v15.0 bitcoind.rs](https://raw.githubusercontent.com/wizardsardine/liana/v15.0/liana-gui/src/node/bitcoind.rs)); master pins 31.1 with the official hash of `bitcoin-31.1-win64.zip` ([master bitcoind.rs](https://raw.githubusercontent.com/wizardsardine/liana/master/liana-gui/src/node/bitcoind.rs)). It writes its own `bitcoin.conf` (rpcport, port, prune; installer default `PRUNE_DEFAULT = 15000`) and starts `bitcoind.exe -chain=… -datadir=%APPDATA%\Liana\bitcoind\datadir` detached. **With BTCortex this must be avoided**: it would be a second Bitcoin Core with its own chain data.
- **Electrum** since 7.0; **Liana Connect** (hosted, account login, mainnet and signet) since 7.0 ([CHANGELOG](https://raw.githubusercontent.com/wizardsardine/liana/master/CHANGELOG.md)).

#### Tor

No Tor or SOCKS settings exist in the daemon configuration (Electrum takes only `addr` and `validate_domain`), so `.onion` Electrum servers cannot be used and outbound connections are clearnet.

#### Hardware wallets, PSBT, QR, SD

async-hwi 0.0.33 ([README](https://raw.githubusercontent.com/wizardsardine/async-hwi/master/README.md)): BitBox02 ≥ 9.15.0, Coldcard ≥ 6.2.1X (Edge firmware), Jade ≥ 1.0.30, Ledger Bitcoin app ≥ 2.1.2, Specter DIY ≥ 1.8.0. The [signing-device page](https://lianawallet.com/resources/guides/signing-devices/) lists Ledger Nano S Plus, Nano X, Stax, Flex, Nano Gen 5; Coldcard Mk4, Mk5, Q; BitBox02, BitBox Nova; Jade, Jade Plus, Jade Core (no Taproot miniscript); Specter DIY; Krux. Trezor is not listed. PSBTs are imported and exported as files; SD-card (air-gap) exchange for Krux since 11.0. No QR signing was found.

#### Miniscript, multisig, BIP329

Miniscript policies with a primary path and timelocked recovery paths, multisig in any path, Taproot (experimental since 5.0). BIP329 label export since 10.0 (`getlabelsbip329`); labels are imported through the JSON wallet backup ([export.rs](https://raw.githubusercontent.com/wizardsardine/liana/master/liana-gui/src/export.rs)). Encrypted descriptor backups (draft BIP138) since 13.0.

#### Pitfalls and security

- Hot signers: `mnemonic-*.txt` files in the network directory. BTCortex must never read, back up or include them in diagnostics.
- Data layout change in 11.0 (older versions cannot open newer wallets): never downgrade.
- Unsigned executable: SmartScreen prompts. The Liana website warns that a Coldcard RNG vulnerability "is being exploited" (hardware scope).
- Bitcoind address must be an IP literal (`localhost` is rejected).

### 7.3 Nunchuk (`nunchuk`)

#### Facts at a glance

| Item | Value |
|---|---|
| Latest stable | **2.9.1**, October 2026 (release page: 9 October; feed: 2026-10-10) ([release](https://github.com/nunchuk-io/nunchuk-desktop/releases/tag/2.9.1)); 2.9.0 on 2026-10-08 moved to Qt 6 ([feed](https://github.com/nunchuk-io/nunchuk-desktop/releases.atom)) |
| Maintenance | Active; commits on 2026-10-14 ([commits](https://github.com/nunchuk-io/nunchuk-desktop/commits/main)) |
| Windows | x64, Windows 10+: Inno Setup installer (admin) and portable ZIP; **unsigned** |
| Verification | `SHA256SUMS` + `SHA256SUMS.asc` signed by a CI workflow; release notes link key `8C8ECD3F660CA53CD878792A6E38A462ED2EF525` |
| Back ends | Electrum (default `mainnet.nunchuk.io:51001`), Bitcoin Core RPC (user/password) |
| Licence | GPL v3 |
| Recommended level | `external-launcher`, P2 |

#### Windows distribution and unattended installation

- `nunchuk-windows-v<v>-x64-setup.exe`: Inno Setup with `PrivilegesRequired=admin`, `DefaultDirName={autopf}\Nunchuk`, `MinVersion=10.0`, x64 only ([windows-installer.iss](https://raw.githubusercontent.com/nunchuk-io/nunchuk-desktop/main/reproducible-builds/windows-installer.iss)). Upstream's smoke test installs with `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /NOCANCEL /SP- /NOICONS /TASKS=` and uninstalls with `/VERYSILENT /NORESTART` ([package_windows.ps1](https://raw.githubusercontent.com/nunchuk-io/nunchuk-desktop/main/reproducible-builds/package_windows.ps1)).
- `nunchuk-windows-v<v>-x64-portable.zip`: `nunchuk-qt.exe`, `hwi.exe`, `qt6keychain.dll`, `build-info.json`, Qt 6.9.3, OpenSSL 3.5.7, MSVC runtime. **Preferred** for BTCortex (per-user, no elevation).
- The build workflow states "Windows release artifacts are unsigned" ([build-windows.yml](https://raw.githubusercontent.com/nunchuk-io/nunchuk-desktop/main/.github/workflows/build-windows.yml)).

#### Verification

[`sign-release-checksums.yml`](https://raw.githubusercontent.com/nunchuk-io/nunchuk-desktop/main/.github/workflows/sign-release-checksums.yml) downloads all release assets, writes `SHA256SUMS` and a detached armoured `SHA256SUMS.asc` with a key whose fingerprint is a repository variable and whose private key is a GitHub secret. The release notes link `8C8ECD3F660CA53CD878792A6E38A462ED2EF525` on [keys.openpgp.org](https://keys.openpgp.org/vks/v1/by-fingerprint/8C8ECD3F660CA53CD878792A6E38A462ED2EF525) (no user ID published). Because signing happens in CI, the signature proves "built and published by the Nunchuk pipeline", not an independent developer attestation. Windows reproducible builds are "standby and not yet supported for independent verification" ([README](https://github.com/nunchuk-io/nunchuk-desktop)).

#### Bundled HWI from a fork

[`windows-dependencies.lock.json`](https://raw.githubusercontent.com/nunchuk-io/nunchuk-desktop/main/reproducible-builds/windows-dependencies.lock.json) pins `hwi-3.2.4-windows-x86_64.zip` from **`github.com/nogibi/HWI`** (SHA-256 `2dcfb673…0b28`). Upstream `bitcoin-core/HWI` is at 3.2.0; the fork's 3.2.1–3.2.4 releases (8–9 October) add `registerdescriptor` for Ledger, BitBox02, Jade and Coldcard, miniscript and MuSig2 descriptor parsing and several multisig fixes ([nogibi/HWI releases](https://github.com/nogibi/HWI/releases)). Flag this neutrally: BTCortex should not reuse Nunchuk's `hwi.exe` for its own HWI integration.

#### Configuration storage on Windows

Settings use `QSettings(NativeFormat, UserScope, "nunchuk", "NunchukClient")` ([AppSetting.cpp](https://raw.githubusercontent.com/nunchuk-io/nunchuk-desktop/main/Models/AppSetting.cpp), [main.cpp](https://raw.githubusercontent.com/nunchuk-io/nunchuk-desktop/main/app/main.cpp)), which on Windows means the registry, `HKEY_CURRENT_USER\Software\nunchuk\NunchukClient` (Qt convention, not observed). Keys are unprefixed for guests and become `<group>/<key>` once a group is set; `primaryServer`, `isStarted` and `mainnetList` are always unprefixed.

| Key | Meaning / default ([AppSetting.h](https://raw.githubusercontent.com/nunchuk-io/nunchuk-desktop/main/Models/AppSetting.h)) |
|---|---|
| `mainnestServer` (sic), `testnetServer`, `signetServer` | Electrum servers; defaults `mainnet.nunchuk.io:51001`, `testnet.nunchuk.io:50001`, `ssl://mempool.space:60602` |
| `primaryServer` | Network (`Chain::MAIN` by default) |
| `enableDualServer`, `secondaryServer` | Optional second server |
| `enableCoreRPC`, `coreRPCAddress`, `coreRPCPort`, `coreRPCName`, `coreRPCPassword` | Bitcoin Core RPC (127.0.0.1, 8332 or 18332) |
| `enableTorProxy`, `torProxyAddress`, `torProxyPort`, `torProxyName`, `torProxyPassword` | SOCKS5 proxy (127.0.0.1:9050) |
| `certificateFile`, `enableCertificateFile` | Pinned Electrum TLS certificate |
| `hwiPath`, `enableCustomizeHWIDriver` | HWI executable (default `hwi`) |
| `enableDBEncryption` | Database encryption (false) |

Electrum server strings: `ssl://host:port` for TLS, anything else plain TCP, default port 50001 ([libnunchuk Electrum client](https://raw.githubusercontent.com/nunchuk-io/libnunchuk/main/src/backend/electrum/client.cpp)). Pre-writing these registry values while Nunchuk is closed is technically possible but relies on undocumented keys and the group prefix; BTCortex should present the values for the user to enter until this is tested.

#### Back ends

- **Electrum**: protocol `1.3`–`1.4.2`; batching for ElectrumX, electrs and Fulcrum. TLS: pinned file → chain and host checked; unpinned → self-signed accepted with a warning; `.onion` → no verification.
- **Bitcoin Core RPC** ([corerpc client](https://raw.githubusercontent.com/nunchuk-io/libnunchuk/main/src/backend/corerpc/client.cpp)): wallet `nunchuk` created with `createwallet nunchuk true true "" false` (a descriptor wallet by default on Core 23+) and `importdescriptors` (≥ 23.0); HTTP basic auth only (**no cookie**), so BTCortex must create a dedicated `rpcauth` user. No `load_on_startup`: on pruned nodes keep `wallet=nunchuk` in `bitcoin.conf`. `rescanblockchain` cannot reach below the prune height.

#### Hardware wallets, PSBT, QR, SD, miniscript, BIP329

[nunchuk.io](https://nunchuk.io/) lists Ledger, Trezor, Blockstream Jade, BitBox, Foundation Passport, Keystone, Krux, TwentyTwo, SeedSigner, TAPSIGNER and Coldcard (USB through HWI, QR, SD; TAPSIGNER by NFC, mainly on mobile; desktop NFC readers not verified). Miniscript was announced on 2025-08-27 ([blog](https://nunchuk.io/blog/miniscript-programmable-bitcoin)): native SegWit miniscript with Coldcard, TAPSIGNER, Jade, Ledger, Specter DIY; Taproot miniscript with Coldcard, Ledger, Specter DIY; MuSig2 with software keys; wallet configurations export as output descriptors or BSMS. libnunchuk has a `miniscript` module ([src](https://github.com/nunchuk-io/libnunchuk/tree/main/src)). BIP329 not found.

#### Assisted services

Plans for individuals, families/groups and advisors (collaborative custody, inheritance, group wallets) need a Nunchuk account; the free wallet works without one. BTCortex should describe these neutrally and never route keys or seeds to them.

#### Pitfalls and security

- Default Electrum server is Nunchuk's: it learns the wallet's addresses.
- Software keys can be created in the app; the database is not encrypted by default.
- Installer needs administrator rights; the portable ZIP does not.
- Unsigned binaries (SmartScreen), CI-held signing key, HWI from a fork.

### 7.4 Caravan (`caravan`)

#### Facts at a glance

| Item | Value |
|---|---|
| Latest | `caravan-coordinator@1.19.2`, 2026-07-20; `@caravan/psbt@2.1.1` 2026-09-17 ([feed](https://github.com/caravan-bitcoin/caravan/releases.atom)) |
| Maintenance | Active; commits on 2026-10-15, including an Unchained contributor ([commits](https://github.com/caravan-bitcoin/caravan/commits/main)) |
| Windows | No package: hosted site, Docker image `caravanbitcoin/coordinator` (amd64/arm64, [Docker Hub](https://hub.docker.com/v2/repositories/caravanbitcoin/coordinator/tags?page_size=5)) or source build (Node ≥ 24) |
| Back ends | Public Esplora APIs (`unchained.mempool.space` default, `blockstream.info`) or private Bitcoin Core through a CORS proxy |
| Licence | MIT ([LICENSE](https://raw.githubusercontent.com/caravan-bitcoin/caravan/main/LICENSE)) |
| Recommended level | `external-launcher`, P3 |

#### What it is

A stateless React single-page app ("It does not itself store any data") for multisig wallets, forked from Unchained's Caravan with libraries renamed to `@caravan/*` ([README](https://raw.githubusercontent.com/caravan-bitcoin/caravan/main/README.md), [coordinator README](https://raw.githubusercontent.com/caravan-bitcoin/caravan/main/apps/coordinator/README.md)). Hosted at caravanmultisig.com (plus GitHub Pages and Vercel links). Local options: `docker run -p 8000:80 caravan:latest` (or the official image) or `npm run build:coordinator`.

#### Back ends

- **Public** ([client.ts](https://raw.githubusercontent.com/caravan-bitcoin/caravan/main/packages/caravan-clients/src/client.ts)): `https://unchained.mempool.space/api` (default) or `https://blockstream.info/api`, mainnet and testnet. Every address is revealed to the operator.
- **Private**: Bitcoin Core RPC from the browser with HTTP basic auth ([bitcoind.ts](https://raw.githubusercontent.com/caravan-bitcoin/caravan/main/packages/caravan-clients/src/bitcoind.ts)). Bitcoin Core sends no CORS headers, so a reverse proxy must add them; upstream ships an nginx template (listen 8080 → `127.0.0.1:8332`) and says CORS headers "are essential to protecting the security of your coins". The user creates a watch-only wallet (`createwallet wallet_name="watcher" blank=true disable_private_keys=true load_on_startup=true`) and sets `walletName`; Caravan imports with `importdescriptors` (timestamp `"now"` or `0`) ([wallet.ts](https://raw.githubusercontent.com/caravan-bitcoin/caravan/main/packages/caravan-clients/src/wallet.ts)), so it works with Core 30/31 by code path. On pruned nodes, use timestamp "now" for new wallets only.

#### Hardware wallets, PSBT, QR

[`@caravan/wallets`](https://raw.githubusercontent.com/caravan-bitcoin/caravan/main/packages/caravan-wallets/src/index.ts): direct keystores JADE, BITBOX, TREZOR, LEDGER, LEDGER_V2 (policy registration with HMACs); indirect HERMIT, COLDCARD, CUSTOM, BCUR2 (BC-UR 2 QR, 1.19.0+). Direct keystores rely on browser USB APIs, so use a Chromium-based browser; embedding in WebView2 is untested. The README still says Trezor Bridge is required.

#### Wallet configuration file

`MultisigWalletConfig` ([types.ts](https://raw.githubusercontent.com/caravan-bitcoin/caravan/main/packages/multisig/src/types.ts)):

```json
{
  "name": "Family vault",
  "uuid": "…",
  "addressType": "P2WSH",
  "network": "mainnet",
  "quorum": { "requiredSigners": 2, "totalSigners": 3 },
  "extendedPublicKeys": [ { "xfp": "<8 hex digits>", "bip32Path": "m/48'/0'/0'/2'", "xpub": "xpub…" } ],
  "ledgerPolicyHmacs": [ { "xfp": "<8 hex digits>", "policyHmac": "…" } ]
}
```

BTCortex can generate this file (watch-only) from xpubs or a `sortedmulti` descriptor it already holds. The value `"P2WSH"` follows Caravan's historic naming and was not re-checked against the current enum.

#### What BTCortex could host locally

The MIT licence allows serving a built copy from BTCortex's sidecar on loopback, together with a loopback CORS proxy limited to that origin and a dedicated `rpcauth` user whose `rpcwhitelist` covers only the RPCs listed above. That is a later step (`connected-application`); for now launch the coordinator in the user's browser with a generated configuration file.

### 7.5 Wasabi Wallet (`wasabi-wallet`)

**At a glance.** v2.8.4, published 2026-10-13 ([release](https://github.com/WalletWasabi/WalletWasabi/releases/tag/v2.8.4)). Active: latest master commit 2026-10-21, "Remove Indexer (#15190)" ([commits API](https://api.github.com/repos/WalletWasabi/WalletWasabi/commits?per_page=1)). MIT. Single-signature only (BIP84/BIP86), with a WabiSabi CoinJoin client, bundled Tor and BIP157/158 client-side filtering. Recommended level: **`fully-managed`** (P2, feasibility medium).

**Maintenance after zkSNACKs.**
- zkSNACKs announced on 2024-05-02 that its coordinator would stop on 2024-06-01. It said Wasabi would "continue to function as a regular bitcoin wallet" and that it would fund basic maintenance. The previous week it had blocked US citizens and residents from its websites and products ([NoBS Bitcoin](https://nobsbitcoin.com/zksnacks-to-suspend-its-coinjoin-coordination-service-on-june-1st)). The original blog post on blog.wasabiwallet.io is offline: the host did not resolve on 2026-10-21.
- v2.0.8 (2024-06-01) added custom coordinators, Tor bridges and Tails/Whonix "connect-only" mode (`--UseTor=EnabledOnlyRunning`). The repository "transferred from zkSNACKs to its own self-named organization" ([v2.0.8 release](https://github.com/WalletWasabi/WalletWasabi/releases/tag/v2.0.8)).
- Development has continued at a steady pace since then:
  - 2.7.0 (2025-08-30): Bitcoin RPC endpoints (including onion RPC), per-network config files, no more bundled bitcoind, full RBF by default ([2.7.0](https://api.github.com/repos/WalletWasabi/WalletWasabi/releases/tags/v2.7.0)).
  - 2.8.0 (2026-06-27): P2P compact-filter synchronisation "instead of a centralized Wasabi server", wallet-birthday checkpoints, paying inside a CoinJoin, batching, signet, .NET 10 ([2.8.0](https://api.github.com/repos/WalletWasabi/WalletWasabi/releases/tags/v2.8.0)).
- The website names no company. It describes the project as free and open source and sends users to "third-party" coordinators ([wasabiwallet.io](https://wasabiwallet.io/)). The MSI is Authenticode-signed by maintainer Lucas Ontivero ([install guide](https://docs.wasabiwallet.io/using-wasabi/InstallPackage.html)).

**Coordinator situation.**
- `CoordinatorUri` is empty by default on mainnet, testnet and signet ([Constants.cs](https://raw.githubusercontent.com/WalletWasabi/WalletWasabi/v2.8.4/WalletWasabi/Helpers/Constants.cs)). "A coordinator must be configured before using coinjoin for the first time" ([CoinJoin.md](https://raw.githubusercontent.com/WalletWasabi/WasabiDoc/master/docs/using-wasabi/CoinJoin.md)).
- Discovery is left to the user: Wasabi Nostr, the Liquisabi statistics site or the community ([FAQ](https://docs.wasabiwallet.io/FAQ/FAQ-UseWasabi.html)).
- Fees: since 2.2.0 the client refuses rounds with a coordination fee and pays only the mining fee. The coordinator sets that rate, capped by `MaxCoinJoinMiningFeeRate` (default 50). Decomposition leftovers of up to 10 000 sats go to the coordinator.
- **BTCortex must never pick a coordinator.** The choice is a trust and jurisdiction decision for the user.

**Windows distribution and unattended install** ([release assets](https://api.github.com/repos/WalletWasabi/WalletWasabi/releases?per_page=5), [Product.wxs](https://raw.githubusercontent.com/WalletWasabi/WalletWasabi/v2.8.4/WalletWasabi.WindowsInstaller/Product.wxs)):

| Artefact | Details |
|---|---|
| `Wasabi-2.8.4.msi` | WiX, `InstallScope="perMachine"`, x64, `C:\Program Files\WasabiWallet\`, UpgradeCode `{D8E80773-D8CF-4031-B8B3-AA750AF0B413}`, `MajorUpgrade` refuses downgrades, optional "launch `wassabee.exe`" on finish. Unattended: `msiexec /i Wasabi-2.8.4.msi /qn /norestart`, **elevated** (untested). |
| `Wasabi-2.8.4-win-x64.zip` | Self-contained, no installer. **Preferred for zero-touch**: extract to `%LOCALAPPDATA%\Programs\BTCortex\wasabi\2.8.4\` with no elevation. The website links only the MSI, but the ZIP is an official release asset with its own `.asc`. |
| Executables | `wassabee.exe` (GUI), `wassabeed.exe` (daemon) |
| Requirements | Windows 10 1607+ or Windows 11 23H2+; **no arm64 Windows build** |

**Verification.**
- Every asset has a detached `.asc`. `SHA256SUMS`, `SHA256SUMS.asc` and `SHA256SUMS.wasabisig` cover the whole set.
- The OpenPGP key is still the zkSNACKs key: `6FB3 872B 5D42 292F 5992 0797 8563 4832 8949 861E`, RSA-2048, `zkSNACKs <zksnacks@gmail.com>`, valid until 2028-02-24 ([PGP.txt](https://raw.githubusercontent.com/WalletWasabi/WalletWasabi/v2.8.4/PGP.txt), [install guide](https://docs.wasabiwallet.io/using-wasabi/InstallPackage.html)).
- `.wasabisig` is presumably for the in-app updater (not verified).

**Configuration on Windows.**
- Data directory: `%APPDATA%\WalletWasabi\Client` ([FAQ](https://docs.wasabiwallet.io/FAQ/FAQ-UseWasabi.html); `EnvironmentHelpers.GetDataDir("WalletWasabi/Client")` in [Config.cs](https://raw.githubusercontent.com/WalletWasabi/WalletWasabi/v2.8.4/WalletWasabi.Client/Configuration/Config.cs)).
- Files ([PersistentConfigManager.cs](https://raw.githubusercontent.com/WalletWasabi/WalletWasabi/v2.8.4/WalletWasabi.Client/Configuration/PersistentConfigManager.cs)):
  - One config per network: `Config.json` (mainnet), `Config.TestNet.json` (testnet4), `Config.RegTest.json`, `Config.Signet.json`.
  - A `network` file records the last network.
  - `UIConfig.json` and the `Wallets\` folder.
  - `.wasabi-lock` is held open exclusively while an instance runs ([SingleInstanceChecker.cs](https://raw.githubusercontent.com/WalletWasabi/WalletWasabi/v2.8.4/WalletWasabi.Client/SingleInstanceChecker.cs)).
- **The network is not a key in the file.** It is chosen by the file name and `--network`.
- Keys written since 2.8.0 (`ConfigVersion` 4), in order ([Serialization.cs](https://raw.githubusercontent.com/WalletWasabi/WalletWasabi/v2.8.4/WalletWasabi.Client/Configuration/Serialization.cs)): `CoordinatorUri`, `UseTor`, `TerminateTorOnExit`, `TorBridges`, `DownloadNewVersion`, `BitcoinRpcCredentialString`, `BitcoinRpcEndPoint`, `JsonRpcServerEnabled`, `JsonRpcUser`, `JsonRpcPassword`, `JsonRpcServerPrefixes`, `DustThreshold`, `EnableGpu`, `CoordinatorIdentifier`, `ExchangeRateProvider`, `FeeRateEstimationProvider`, `ExternalTransactionBroadcaster`, `MaxCoinJoinMiningFeeRate`, `AbsoluteMinInputCount`, `MaxDaysInMempool`, `ExperimentalFeatures`, `ConfigVersion`.
- Older formats are detected and decoded:
  - 2.6.0 format: `BackendUri` (indexer) and `UseBitcoinRpc`.
  - Pre-2.6.0 format: per-network keys such as `MainNetBackendUri`, `MainNetBitcoinRpcEndPoint` and `MainNetCoordinatorUri`.
- The public FAQ still shows the 2.6.0-era `"UseBitcoinRpc": true`. 2.8.4 neither writes nor needs it: a non-empty endpoint enables RPC.
- Defaults that matter:
  - `UseTor` is `"Enabled"` (`"EnabledOnlyRunning"` on Tails and Whonix).
  - `DownloadNewVersion` is `true`.
  - `JsonRpcServerEnabled` is `false` on mainnet and `true` on the test networks.
  - The three external providers default to `MempoolSpace`.
  - The mainnet `BitcoinRpcEndPoint` is empty. Testnet4 defaults to `http://localhost:48332`, signet to `http://localhost:38332`, regtest to `http://localhost:18443`.

Keys BTCortex would set to wire Wasabi to the managed pruned node. Keep every other key exactly as Wasabi wrote it, and write only when `ConfigVersion` is 4:

```json
{
  "BitcoinRpcEndPoint": "http://127.0.0.1:8332",
  "BitcoinRpcCredentialString": "cookiefile=C:\\Users\\<user>\\AppData\\Local\\Bitcoin\\.cookie",
  "DownloadNewVersion": false,
  "CoordinatorUri": ""
}
```

- **Credential string.** The FAQ example is `rpcuser:rpcpassword`. The 2.8.4 migration code turns a `bitcoin.conf` cookie into `cookiefile=<path>` ([PersistentConfig.cs](https://raw.githubusercontent.com/WalletWasabi/WalletWasabi/v2.8.4/WalletWasabi.Client/Configuration/PersistentConfig.cs)). That cookie format is inferred and **untested**, as is re-reading the cookie after a node restart. A dedicated `rpcauth` user is the robust fallback.
- **Node side.**
  - `server=1` and `blockfilterindex=1`. The filter index is compatible with pruning.
  - 2.8.0 fetches filters over RPC in batches, only while the node is running and synchronised. The node also supplies blocks, fee estimates and broadcasting ([BitcoinFullNode](https://docs.wasabiwallet.io/using-wasabi/BitcoinFullNode.html)). If any of these fail, Wasabi falls back to P2P peers and mempool.space.
  - The FAQ: pruned nodes work if BIP158 filters are enabled. Blocks below the prune height then come from P2P peers.
  - Wasabi creates no wallet in Bitcoin Core, so the Core 30 removal of legacy wallets is irrelevant.
  - 2.8.4 uses `getblock` verbosity 3, so Core 23 or later (inference).
  - Never point it at Knots 29.4.1 or later (hard-forked chain).

**When pre-configuration is safe.**
- **Preferred**: pass startup parameters on every BTCortex-initiated launch. They override `Config.json`, are never persisted, and need no file edits:

  ```text
  wassabee.exe --network=main --bitcoinrpcendpoint=http://127.0.0.1:8332 --bitcoinrpccredentialstring=cookiefile=<datadir>\.cookie --downloadnewversion=false
  ```

- **File edits**: only while no instance holds `.wasabi-lock`, only on a file Wasabi created (`ConfigVersion` 4), atomically and with a backup.
- An unreadable or partial config makes Wasabi write `Config.Default.json` and refuse to start with an `InvalidDataException`. Never write a fresh file from scratch.

**CLI flags** ([StartupParameters.md](https://raw.githubusercontent.com/WalletWasabi/WasabiDoc/master/docs/using-wasabi/StartupParameters.md), [Daemon README](https://raw.githubusercontent.com/WalletWasabi/WalletWasabi/v2.8.4/WalletWasabi.Daemon/README.md)):
- Syntax: `--switch=value`, case-insensitive. Environment variables: `WASABI_<SWITCH>`. Precedence: command line, then environment, then file.
- Network: `--network=main|testnet|signet|regtest`. `testnet` means testnet4.
- Command-line or environment only: `--datadir`, `--loglevel`, `--logmodes`, `--blockonly`, `--wallet` (repeatable), `--rpconionenabled`, `--torsocksport`, `--torcontrolport`, `--torfolder`.
- The documented example `--bitcoinrpcendpoint "http://127.0.0.1:8333"` uses the P2P port by mistake. The mainnet RPC port is 8332.

**Tor.**
- Wasabi bundles Tor (0.4.9.13 in 2.8.4) and starts it itself.
- `UseTor` takes `Enabled`, `Disabled` or `EnabledOnlyRunning`. The last connects to an already-running Tor ("connect-only"). `true` and `false` are also accepted.
- Use `EnabledOnlyRunning` with the BTCortex-managed `tor` only after testing control-port authentication. Otherwise let Wasabi run its own Tor on distinct ports.

**Hardware wallets, PSBT, QR** ([ColdWasabi.md](https://raw.githubusercontent.com/WalletWasabi/WasabiDoc/master/docs/using-wasabi/ColdWasabi.md), [FAQ](https://docs.wasabiwallet.io/FAQ/FAQ-UseWasabi.html)):
- HWI is bundled (2.0.8: HWI 3.0.0; 2.3.0: HWI 3.1.0).
- Tested devices: Trezor Model T, Ledger Nano S, S Plus and X, Coldcard. Also BitBox02-BtcOnly (2.0.7) and BitBox02 Nova (2.8.4), with Jade named on the website. Trezor One is not supported.
- Hardware-wallet wallets are watch-only until the device signs over USB. They cannot join CoinJoins.
- PSBT: enable "PSBT workflow", then "Save PSBT file" for Coldcard via microSD. Broadcast the `-final.txn` with the Broadcaster tool.
- Coldcard "Export Wallet > Wasabi Wallet" produces `new-wallet.json` for a watch-only import.
- No QR PSBT exchange is documented.

**Multisig, miniscript, labels.** None documented. The [BIP list](https://raw.githubusercontent.com/WalletWasabi/WasabiDoc/master/docs/using-wasabi/BIPs.md) covers BIP 21, 32, 38, 39, 44, 72, 78, 84, 86, 125, 141, 143, 144, 157, 158, 173, 174, 341 and 352 (send only), plus SLIP-39. It does not list BIP329.

**JSON-RPC** ([RPC.md](https://raw.githubusercontent.com/WalletWasabi/WasabiDoc/master/docs/using-wasabi/RPC.md)):
- Listens on `http://127.0.0.1:37128/`. Wallet calls use `/<WalletName>`.
- HTTP authentication. No TLS, no batching.
- Methods include `getstatus` and `stop` (useful) as well as `send`, `startcoinjoin` and `listkeys` (never automate).
- Some methods work without the wallet password, and passwords travel in request bodies. Keep it off unless the user asks.

**Pitfalls.**
- The MSI needs administrator rights.
- `DownloadNewVersion=true` lets Wasabi fetch updates behind BTCortex's back. Set it to false for managed installs.
- The documentation lags the code: it still shows `UseBitcoinRpc`.
- The config schema changed in 2.6.0, 2.7.0 and 2.8.0. Master removed the indexer on 2026-10-21, so expect the next version to drop it entirely.

**Security and legal.**
- Tor is on by default. Disabling it is "strongly" discouraged.
- WabiSabi stops the coordinator from linking inputs to outputs. It still sees the registered inputs and can ban them.
- Legal context, stated neutrally: zkSNACKs cited the need for "legal certainty". Regulatory treatment of CoinJoin coordinators varies by jurisdiction; see the Samourai convictions under `ashigaru-terminal`.

### 7.6 Bitcoin-Safe (`bitcoin-safe`)

**At a glance.** 2.1.3, published 2026-08-05 ([releases](https://github.com/andreasgriffin/bitcoin-safe/releases)). Active: latest commit 2026-10-20 ([commits](https://github.com/andreasgriffin/bitcoin-safe/commits.atom)), and `pyproject.toml` on main already reads 2.2.0. GPL-3.0-only. Python/PyQt6 on BDK. Recommended level: **`connected-application`** (P2, feasibility medium).

What it is:
- A cold-storage coordinator for hardware signers.
- **Mainnet "enforces hardware-only seeds"**, so it never holds a software seed on mainnet ([website](https://bitcoin-safe.org/en/)). This suits BTCortex's no-seed policy well.

**Windows distribution and unattended install** ([download](https://bitcoin-safe.org/en/download), [NSIS script](https://raw.githubusercontent.com/andreasgriffin/bitcoin-safe/main/tools/build_wine/bitcoin_safe.nsi)):

| Artefact | Details |
|---|---|
| `Bitcoin-Safe-2.1.3-setup.exe` | NSIS, `RequestExecutionLevel admin`, `$PROGRAMFILES64\…`. Writes the Add/Remove Programs entry and a `bitcoin:` URI handler under **HKCU** (a mixed model). Creates desktop and Start Menu shortcuts, including a "Testnet" shortcut that passes `--testnet`, a flag `__main__.py` on main does not define. Reinstalling wipes `$INSTDIR`. Uninstalling leaves user data in place. There is no explicit `/S` handling; standard NSIS silent mode is untested. |
| `Bitcoin-Safe-2.1.3-portable.exe` | Single executable. **Preferred for zero-touch**: copy to `%LOCALAPPDATA%\Programs\BTCortex\bitcoin-safe\2.1.3\` with no elevation. |
| Signing | Both Authenticode-signed through SignPath (certificate from the SignPath Foundation) ([code-signing policy](https://bitcoin-safe.org/en/code-signing-policy/)) |
| Architecture | x64 (Program Files 64-bit). Supported Windows versions are not documented. |

**Verification.**
- `gpg --verify Bitcoin-Safe-<v>-portable.exe.asc` with the key `2759 AA71 4856 8ECC B03B 7630 1D82 124B 440F 612D`, from keys.openpgp.org. The key server shows no identity for it ([search](https://keys.openpgp.org/search?q=2759AA7148568ECCB03B76301D82124B440F612D)).
- Builds are reproducible. Windows hashes match after stripping Authenticode with `osslsigncode` ([reproducibility](https://bitcoin-safe.org/en/library/reproducibility-and-security/)).
- The app checks update signatures itself (pysequoia, python-gnupg).

**Backends and configuration.** Sources: [config.py](https://raw.githubusercontent.com/andreasgriffin/bitcoin-safe/main/bitcoin_safe/config.py), [network_config.py](https://raw.githubusercontent.com/andreasgriffin/bitcoin-safe/main/bitcoin_safe/network_config.py).
- **Location.**
  - Config file: `appdirs.user_config_dir("bitcoin_safe")` / `bitcoin_safe.conf` (JSON, unencrypted; only the app-lock verifier is protected).
  - On Windows this is expected to be `%LOCALAPPDATA%\bitcoin_safe\bitcoin_safe\bitcoin_safe.conf`, inferred from appdirs and not observed.
  - Wallets live in `<config dir>\<NETWORK>\`.
- **Per-network `NetworkConfig` keys.**
  - `server_type`: `CompactBlockFilter`, `Electrum`, `Esplora` or `RPC`.
  - Electrum: `electrum_url`, `electrum_use_ssl`. Mainnet default `electrum.blockstream.info:50002`, SSL.
  - Esplora: `esplora_url`. No mainnet default.
  - RPC: `rpc_ip` (`127.0.0.1`), `rpc_port` (8332), `rpc_username`, `rpc_password`. There is no cookie option.
  - Mempool: `mempool_url` (`https://mempool.space/`, with an onion alternative).
  - Proxy: `proxy_url` (default `None`).
  - Compact-filter peers: `cbf_connections` (2), `configured_peers`, and `peer_selection_mode` (`additional` or `only_configured`).
  - Notification listener: `p2p_listener_type` (`automatic` or `deactive`).
- **Default backend.** The README and code default to compact block filters through the Kyoto module for BDK, using random Bitcoin Core peers. Initial sync takes 5–30 minutes ([CBF page](https://bitcoin-safe.org/en/library/compact-block-filters/)). The code-signing privacy statement says the defaults are Blockstream's Electrum/Esplora servers. BTCortex should not rely on either and should set `server_type` explicitly once the format is validated.
- **Own node as filter peer.**
  - Core needs `blockfilterindex=1`, `peerblockfilters=1` and P2P listening (`listen=1`, `bind=127.0.0.1`). This **conflicts with BTCortex's zero-touch node default `listen=0`**; see the electrum-indexers-explorers notes.
  - A pruned node serves only the last 288 blocks (BIP159), so the client still needs other peers for older matches (`peer_selection_mode` `additional`). This is untested.
- **RPC back end.** It exists in code; whether the 2.1.3 UI exposes it was not verified.

**What BTCortex can safely pre-configure.** Nothing by default: compact block filters from random peers work with the pruned test machine out of the box. Editing `network_configs` is possible only while the app is closed, and only after the JSON shape (with its migration code) has been validated against the installed release. Preserve unknown fields.

**CLI.** [`__main__.py`](https://raw.githubusercontent.com/andreasgriffin/bitcoin-safe/main/bitcoin_safe/__main__.py):
- Flags: `--network <bitcoin|testnet|testnet4|signet|regtest>`, `--profile`, `--trace-startup-windows`.
- Positional files: `.psbt`, transactions or wallets.
- Unknown arguments are ignored. There is no data-directory or portable flag.

**Tor.** Not bundled. Set a SOCKS proxy per network (`proxy_url`; dependencies `pysocks` and `aiohttp-socks`) and use the onion mempool URL.

**Hardware, PSBT and QR** ([README](https://raw.githubusercontent.com/andreasgriffin/bitcoin-safe/main/README.md), [website](https://bitcoin-safe.org/en/)):
- USB goes through `bitcoin-usb` on HWI (`hwi >= 3.2.0`, [pyproject](https://raw.githubusercontent.com/andreasgriffin/bitcoin-safe/main/pyproject.toml)).
- QR: animated UR and Coldcard BBQr.
- SD-card files.
- Signers: Coldcard Q, Mk4 and Mk5; BitBox02 and BitBox02 Nova; Passport Core and Prime; Jade and Jade Plus; Trezor Safe 3, 5 and 7; Keystone; Ledger Nano S, S Plus, X and Flex; Specter DIY, Shield and Shield Lite; SeedSigner; Krux; MetroVault.

**Multisig, miniscript, BIP329.**
- Multisig with step-by-step setup, PDF backup sheets that include the descriptor, and test transactions.
- Miniscript and Taproot multisig are not documented.
- **BIP329** label import and export, plus Electrum label import.
- Labels can sync over Nostr ("Sync & Chat", which also carries chat and PSBT sharing).

**Pitfalls and security.**
- The setup.exe needs administrator rights, while the portable executable does not.
- Nostr relays see metadata of encrypted traffic when Sync & Chat is enabled.
- Fee data comes from mempool.space by default.
- Address-poisoning detection is built in.

### 7.7 Bitcoin Keeper (`bitcoin-keeper`)

**At a glance.**
- Mobile wallet: v2.6.3, 2026-10-07 ([releases feed](https://github.com/bithyve/bitcoin-keeper/releases.atom)).
- Keeper Desktop: v0.2.5, 2026-10-06 ([releases feed](https://github.com/bithyve/keeper-desktop/releases.atom)). It must be paired with mobile 2.6.3.
- Recommended level: **`research-only`** (P3).

Ownership and licence:
- Originally developed by BitHyve UK Limited. The website now says it is "community-run … maintained by independent developers" ([bitcoinkeeper.app](https://bitcoinkeeper.app/)).
- Both repositories redirect to the **KeeperCommunity** organisation.
- MIT licence ([repository](https://github.com/KeeperCommunity/bitcoin-keeper)).

**Windows.**
- Only the **Keeper Desktop** companion runs on Windows. It is a Tauri app ([repository](https://github.com/KeeperCommunity/keeper-desktop)) shipped as `Keeper.Desktop_0.2.5_x64-setup.exe` and `Keeper.Desktop_0.2.5_x64_en-US.msi`, with `SHA256SUMS.txt` and `.asc` ([releases](https://github.com/bithyve/keeper-desktop/releases)).
- Its job is to let the phone use USB signers: add a device, run a health check, verify addresses and sign.
- The release notes ask users to verify against "the Keeper release signing key" without giving a fingerprint.
- Mobile APKs are signed by the "Hexa Team" key `389F 4CAD A078 5AC0 E28A 0C18 1BEB DE26 1DC3 CF62`.

**Features.**
- Multi-key wallets: 2-of-3 and 3-of-5 presets or custom.
- A fixed 2-of-3 collaborative wallet.
- Timelocked wallets, plus inheritance and emergency keys.
- An optional server key that cannot spend alone.
- Miniscript "enhanced vaults" with BitBox02, COLDCARD, Tapsigner, Jade and Ledger ([NoBS, 2025-02-06](https://nobsbitcoin.com/bitcoin-keeper-v2-0-1-keeper-desktop-v0-2-0)).
- Electrum server management for the user's own server, with Tor. This comes from a third-party index, the [Start9 wallet guide](https://docs.start9.com/bitcoin-guides/1.0.x/bitcoin-wallets.html).

**BTCortex role.** Offer an Electrum endpoint (onion or private network) for the phone when an unpruned node and an Electrum server exist. Installing and launching Keeper Desktop must wait until its signing key is identified.

### 7.8 Blockstream App (`blockstream-app`)

**At a glance.** 3.6.0, published 2026-09-21 ([releases feed](https://github.com/Blockstream/green_qt/releases.atom)). Active: latest commit 2026-09-21 ([commits](https://github.com/Blockstream/green_qt/commits.atom)). GPL-3.0. Recommended level: **`external-launcher`** (P3).

**Desktop status after the rebrand.**
- Renamed from Blockstream Green to Blockstream App in 2.0.26 (2025-07-10). 3.5.0 removed the remaining "Green" references ([CHANGELOG](https://raw.githubusercontent.com/Blockstream/green_qt/master/CHANGELOG.md)).
- The desktop app is **still maintained and offered**: blockstream.com/app lists 3.6.0 for Windows, macOS and Linux ([product page](https://blockstream.com/app/)).

**Windows distribution.**
- `BlockstreamSetup-x86_64.exe` ([assets](https://github.com/Blockstream/green_qt/releases/expanded_assets/release_3.6.0)) is an Inno Setup installer ([installer.iss.in](https://raw.githubusercontent.com/Blockstream/green_qt/master/installer.iss.in)):
  - `PrivilegesRequired=admin`, so it needs elevation.
  - Installs to `{commonpf}\<vendor>\<name>` in 64-bit mode.
  - Silently installs `vc_redist.x64.exe /install /quiet /norestart` when `MSVCP140.dll` is older than 14.40.
  - Removes old "Blockstream Green" shortcuts and keys.
- Unattended: `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART` (standard Inno Setup switches, untested).
- No portable build.

**Verification.**
- Steps: `gpg --recv-keys 04BEBF2E35A2AF2FFDF1FA5DE7F054AA2E76E792` from keyserver.ubuntu.com, then `gpg --verify SHA256SUMS.asc`, then a hash check ([help article](https://help.blockstream.com/blockstream-app/perform-advanced-wallet-operations/verify-the-blockstream-app-binaries.md)).
- The article gives Linux and macOS hash commands only.

**Configuration on Windows.**
- Data directory ([main.cpp](https://raw.githubusercontent.com/Blockstream/green_qt/master/src/main.cpp)):
  - `--datadir` if given.
  - Otherwise `QStandardPaths::AppLocalDataLocation`, with organisation `Blockstream` and application name `Green`, so expected to be `%LOCALAPPDATA%\Blockstream\Green`.
- Settings: `settings.ini` (QSettings INI) from `GetDataFile("app", "settings.ini")`, so expected to be `%LOCALAPPDATA%\Blockstream\Green\app\settings.ini` (inferred). The file is written with a 2-second debounce and again on exit ([green_settings.cpp](https://raw.githubusercontent.com/Blockstream/green_qt/master/src/green_settings.cpp)).
- Keys:
  - Network and proxy: `use_tor`, `use_proxy`, `proxy_host`, `proxy_port`.
  - Personal Electrum server: `use_personal_node`, `enable_electrum_tls`, `bitcoin_electrum_url`, `testnet_electrum_url`, `liquid_electrum_url`, `liquid_testnet_electrum_url`, `gap_limit`.
  - Other: `enable_spv`, `enable_testnet`, `analytics`, `accepted_tos_version`, `remember_devices`, `incognito`, `recent_wallets`, `language`, window geometry and so on.

Indicative fragment. The URL format and default values were not verified:

```ini
[General]
use_personal_node=true
bitcoin_electrum_url=127.0.0.1:50002
enable_electrum_tls=true
```

**When it is safe.**
- Only while the app is closed. It is single-instance, and its watchdog relaunches the UI.
- Only for singlesig wallets: multisig accounts always use Blockstream's backend.
- Only when BTCortex manages an Electrum server, which needs an unpruned node. On the pruned test machine there is nothing local to point it at.

**CLI.**
- `--datadir`, `--tempdatadir`, `--tor enabled|disabled`, `--proxy host:port`, `--analytics enabled|disabled`, `--testnet`, `--jade enabled|disabled`, `--debugjade`, `--updatecheckperiod` (3600), `--channel`, `--debug`.
- A positional `bitcoin:`, `liquidnetwork:` or `lightning:` URI is forwarded to the running instance.

**Hardware, PSBT, multisig.**
- Jade and Jade Plus over USB, with firmware updates and genuine checks.
- Jade QR Connect and air-gapped Jade signing for watch-only wallets (3.5.0).
- Ledger for singlesig Bitcoin (1.1.0) and Liquid on Nano S (2.0.4).
- Watch-only import from xpubs and descriptors (2.0.5).
- Multisig: Blockstream-cosigned 2-of-2 and 2-of-3 (2-of-3 creation restored in 3.6.0).
- PSBT file workflows are not mentioned. No miniscript; BIP329 not documented.

**Security.**
- Software wallets are hot wallets, and the beta Lightning node (3.5.0) adds hot-wallet risk.
- Multisig depends on Blockstream as co-signer, with timelocked recovery ([blog, 2021](https://blog.blockstream.com/en-blockstream-green-announcing-singlesig-wallets/)).
- Analytics can be disabled with `--analytics disabled`.

### 7.9 Armory (`armory`)

- **Status.** Stale. The last stable release is v0.96.5 (2018-12-24). 0.97 RC1 (2026-05-20) is a testing pre-release ([release](https://github.com/goatpig/BitcoinArmory/releases/tag/0.97-RC1)):
  - A Windows ZIP only (`BitcoinArmory-0.97-RC1-win.zip`, mingw build); mainnet untested by the author.
  - A new `.lmdb` wallet format that requires migration.
  - A rebuilt database: DB_BARE takes about 1 GB, about 20 minutes to build and about 2 GB RAM.
- The dev branch has commits up to 2026-05-20, including a "blockxor" merge ([commits](https://github.com/goatpig/BitcoinArmory/commits.atom)).
- **Node.** It needs a local, unpruned Bitcoin Core and reads its block data. Core 28+ XOR-obfuscates new block directories (`blocks\xor.dat`), which older software cannot read, so 0.96.5 is not expected to work with a fresh Core 28+ data directory (inference).
- **Licence.** Partly AGPL v3, partly MIT ([README](https://github.com/goatpig/BitcoinArmory)).
- **Recommendation.** `research-only`, P3, detection only.

### 7.10 Lily Wallet (`lily-wallet`)

- **Status.** Stale: v1.4.0 (2023-10-12) is the latest release and the last commit was 2023-08-14 ([releases](https://github.com/Lily-Technologies/lily-wallet/releases.atom), [commits](https://github.com/Lily-Technologies/lily-wallet/commits.atom)). It is not archived, and the [website](https://lily-wallet.com/) still advertises v1.3.
- **Windows.** `Lily.Wallet.Setup.1.4.0.exe` with no signatures or checksums attached ([assets](https://github.com/Lily-Technologies/lily-wallet/releases/expanded_assets/lily-wallet-v1.4.0)).
- **Backend.** An Electrum server.
- **Licence.** **Elastic License 2.0**: source-available, with no circumvention of licence-key functionality ([repository](https://github.com/Lily-Technologies/lily-wallet)).
- **Recommendation.** `research-only`, P3. Steer users to maintained coordinators.

### 7.11 Ashigaru Terminal (`ashigaru-terminal`)

- **What it is.** A TUI desktop wallet that acts as the companion for Ashigaru Whirlpool (Zerolink) coinjoins: Tx0, mixing and remixing ([overview](https://ashigaru.rs/docs/ashigaru-terminal-overview/)).
- **Releases.** v1.0.0, released 2025-06-23 alongside a new coordinator announcement ([news](https://ashigaru.rs/news/)). Nothing newer has been announced.
- **Windows.**
  - `ashigaru_terminal_v1.0.0_windows.zip`, available **only via an onion address**.
  - SHA-256 values sit in a PGP-signed message on the clearnet page; the key is on Keybase (`ashigarudev`) with no fingerprint on the site ([download](https://ashigaru.rs/download/)).
  - Data lives in `%APPDATA%\ashigaru`. `-n testnet4` selects Testnet4 ([install](https://ashigaru.rs/docs/ashigaru-terminal-install/)).
- **Code and licence.** The code repository is Tor-only. The project states GPL-3.0 ([website](https://ashigaru.rs/)).
- **Legal context, stated neutrally.** Samourai Wallet's founders were sentenced in November 2025 to five and four years for conspiracy to operate an unlicensed money transmitting business ([SDNY](https://www.justice.gov/usao-sdny/pr/founders-samourai-wallet-cryptocurrency-mixing-service-sentenced-five-and-four-years); the page body was only available as a search extract). The Ashigaru developers are anonymous.
- **Recommendation.** `research-only`, P3, not catalogue-eligible. BTCortex cannot pin a signing key or download over clearnet. CoinJoin coordinators are owned by the privacy-networking scope.

### 7.12 Whirlpool GUI (`whirlpool-gui`)

- **Status.** Discontinued. Samourai's coordinator and back-end servers were seized with the April 2024 indictment. "You have to migrate funds to another wallet like Sparrow", ideally to a new seed ([NoBS, 2024-04-25](https://nobsbitcoin.com/how-to-recover-samourai-wallet-and-implications-for-different-types-of-users); [SDNY, 2024-04-24](https://www.justice.gov/usao-sdny/pr/founders-and-ceo-cryptocurrency-mixing-service-arrested-and-charged-money-laundering)).
- **Recommendation.** `unsupported`, detection only. BTCortex must never ask for the seed.

---

## 8. Vendor companion apps and USB hardware wallets

Trezor, Ledger, BitBox and KeepKey devices and their desktop companions. HWI support is summarised in §5.3; Sparrow (Lark) and Electrum (vendor plugins) do not depend on HWI and already support the Trezor Safe 7 (Sparrow 2.5.5, Electrum ≥ 4.8.0).

### 8.1 Trezor (`trezor`)

**At a glance** (verified 2026-10-21)

| Model | Code | Sold? | Firmware line, latest | Connection | Secure element | HWI 3.2.0 |
|---|---|---|---|---|---|---|
| Safe 7 | T3W1 | Yes | core 2.12.5 (first public 2.9.3, 2025-10-21) | USB-C, Bluetooth 5.0+ (THP-encrypted) | TROPIC01 + EAL6+ Optiga | **No** (THP not implemented) |
| Safe 5 | T3T1 | Yes | core 2.12.5 | USB-C | EAL6+ | Yes |
| Safe 3 | T2B1, T3B1 | Yes | core 2.12.5 | USB-C | EAL6+ | Yes |
| Model T | T2T1 | Retired from sale | core 2.12.5 | USB | None | Yes |
| Model One | T1B1 | Retired from sale | legacy 1.14.1 (2026-03-18) | USB | None | Yes |

- Core firmware 2.12.5 is dated 16 September 2026 in [core/CHANGELOG.md](https://github.com/trezor/trezor-firmware/blob/main/core/CHANGELOG.md); per-model metadata, image URLs and fingerprints (universal and Bitcoin-only) are in `https://data.trezor.io/firmware/<model>/releases.json` ([T3T1](https://data.trezor.io/firmware/t3t1/releases.json), [T3W1](https://data.trezor.io/firmware/t3w1/releases.json), [T1B1](https://data.trezor.io/firmware/t1b1/releases.json)). The firmware repository has no GitHub releases; tags appear in the [Atom feed](https://github.com/trezor/trezor-firmware/releases.atom).
- Support lifetime (trezor.io [Model One](https://trezor.io/trezor-model-one) / [Model T](https://trezor.io/trezor-model-t) pages): both are "retired from sale, not from support"; critical security updates until at least 2036; Model T feature updates until at least 2031; Model One maintenance only.
- Current line-up: [trezor.io/compare](https://trezor.io/compare) lists Safe 7, Safe 5 and Safe 3, each with a Bitcoin-only edition. [Safe 7](https://trezor.io/trezor-safe-7): USB-C, Bluetooth (can be switched off), Qi2 charging, 2.5-inch touchscreen, TROPIC01 + Optiga + STM32U5, SLH-DSA-128 post-quantum boot/firmware verification (vendor claim).

**Connection and Windows.** No driver installation is needed: both firmware lines expose Microsoft WinUSB compatible-ID descriptors ([legacy/winusb.c](https://github.com/trezor/trezor-firmware/blob/main/legacy/winusb.c), [core usb.c](https://github.com/trezor/trezor-firmware/blob/main/core/embed/io/usb/stm32/usb.c)). HWI talks to Trezors over HID (old Model One firmware) or WebUSB through libusb, plus UDP for emulators; it does **not** use Trezor Bridge ([hwilib/devices/trezor.py](https://github.com/bitcoin-core/HWI/blob/master/hwilib/devices/trezor.py)). The Safe 7 requires the encrypted **Trezor-Host Protocol (THP)** for every connection, USB included.

**HWI status.** HWI 3.2.0's vendored trezorlib knows T1B1, T2T1, T2B1, T3T1 and T3B1 but not T3W1 ([models.py at 3.2.0](https://github.com/bitcoin-core/HWI/blob/3.2.0/hwilib/devices/trezorlib/models.py)). [HWI issue #775](https://github.com/bitcoin-core/HWI/issues/775) (open since 2025-02-14) tracks THP: maintainers confirmed on 2025-10-27 that "THP is mandatory on Safe 7" so HWI "currently won't work"; trezorlib 0.20.0 (2026-02-10) has THP, but HWI still needs a design for pairing credentials and session persistence. Limits from the HWI driver: multisig up to n-of-15; no arbitrary input/output scripts; "Transactions containing Taproot inputs cannot have external inputs"; Taproot needs Model One ≥ 1.10.4 or Model T ≥ 2.4.3; non-wallet inputs removed in 1.10.6 / 2.4.4 ([support matrix](https://hwi.readthedocs.io/en/latest/devices/index.html)); **no descriptor registration and no BIP-388 policy signing**.

**PSBT / QR / microSD / multisig / miniscript.** USB (and Bluetooth on the Safe 7) only; no QR, no PSBT-on-microSD (the microSD slot on the Model T and Safe 5 only serves SD-card PIN protection). Multisig: P2SH, P2SH-P2WSH and P2WSH via the host; no Taproot multisig or miniscript. Firmware 2.8.7 (2025-01-22) tightened multisig rules: multisig-to-singlesig change forbidden, per-node paths forbidden in multisig change/receive addresses, and "Unchained Capital's multisig path removed" — coordinators using non-standard per-cosigner paths must be checked against this.

**Safely readable information.** `Initialize`/`GetFeatures` works without the PIN and returns vendor, model, `internal_model`, firmware version, `bootloader_mode`, `firmware_present`, `initialized`, `unlocked`, `pin_protection`, `passphrase_protection`, `unit_btconly`, `capabilities`, `backup_availability`, `label` and `device_id` ([messages-management.proto](https://github.com/trezor/trezor-firmware/blob/main/common/protob/messages-management.proto)). Show model, firmware and Bitcoin-only flag; treat `label` and `device_id` as personal data (never log or send them anywhere). The master fingerprint needs an unlocked device.

**Integration for BTCortex.** `connected-application` through HWI: `hwi enumerate` → `getdescriptors` → watch-only import → `displayaddress` → `signtx` only after an explicit click, with the device showing the details. Firmware, Bitcoin-only firmware and Safe 7 pairing stay in Trezor Suite. Flag the Safe 7 as "not supported by HWI yet; use Trezor Suite or a wallet with THP support" (Sparrow 2.5.5 via Lark, Electrum ≥ 4.8.0).

**Pitfalls.** A running Trezor Suite (internal bridge on 127.0.0.1:21328) or a legacy standalone Bridge (127.0.0.1:21325) can hold the WinUSB interface; close Suite before HWI sessions (expected behaviour, not tested). Two Safe 3 hardware revisions (T2B1 and T3B1) report different internal models.

**Security.** Advisories with dates: Ledger Donjon's Safe 3 evaluation, reported 2024-11-12 ([Trezor page](https://trezor.io/vulnerability/donjon-s-trezor-safe-3-evaluation)): supply-chain countermeasures bypassed by voltage glitching; Safe 5 not affected. TROPIC01 laser fault injection found by Ledger Donjon in late January 2026 ([Trezor response, 2026-06-03](https://trezor.io/blog/news/Trezor-response-TROPIC01-chip-disclosure-no-impact-to-your-funds), [explainer](https://trezor.io/learn/security-privacy/how-trezor-keeps-you-safe/tropic-01-chip-vulnerability-disclosure-what-happened)): hardware issue, no firmware fix; Trezor says the PIN, funds and backup remain protected. Firmware security fixes: 2.10.0 (2026-01-21) BIP-39 side channel; 2.11.0 (2026-03-18) multisig verification bug; 2.12.2 (2026-07-22) external input misidentification and new external outputs in replacement transactions; legacy 1.14.0 BIP-39 side channel; 1.14.1 advanced recovery enforced for mnemonics under 24 words.

### 8.2 Trezor Suite (`trezor-suite`)

**At a glance.** Latest desktop **26.9.3, published 2026-10-01** ([release](https://github.com/trezor/trezor-suite/releases/tag/v26.9.3)); 26.10.1 is a pre-release (2026-10-15). Windows asset `Trezor-Suite-26.9.3-win-x64.exe` (158 791 912 bytes) + `.asc` + `.blockmap`; **x64 only**, no portable build. Licence: **Trezor Reference Source License (T-RSL)**, source-available for "reference use" ([LICENSE.md](https://github.com/trezor/trezor-suite/blob/develop/LICENSE.md)) — do not redistribute; download at install time.

**Installer and unattended install.** electron-builder NSIS **assisted** installer (`oneClick: false`, no `perMachine`), Authenticode-signed with signtool for publishers "SatoshiLabs, s.r.o." / "Trezor Company s.r.o." ([electron-builder-config.js](https://github.com/trezor/trezor-suite/blob/develop/suite/desktop-app/electron-builder-config.js), [signing docs](https://github.com/trezor/trezor-suite/blob/develop/docs/releases/signing-binaries-win.md)). The electron-builder templates accept `/S`, `/currentuser`, `/allusers` and `/D=` ([assistedInstaller.nsh](https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/templates/nsis/assistedInstaller.nsh)); per-user installs go to `%LOCALAPPDATA%\Programs\Trezor Suite\Trezor Suite.exe` ([Suite docs](https://github.com/trezor/trezor-suite/blob/develop/docs/packages/desktop-app/index.md)). Proposed command (to be validated on a clean VM): `Trezor-Suite-<v>-win-x64.exe /S /currentuser`. Suite auto-updates via electron-updater from data.trezor.io unless launched with `--disable-updater`.

**Verification.** `gpg --verify Trezor-Suite-<v>-win-x64.exe.asc` against the **SatoshiLabs 2021 Signing Key**, RSA-4096, fingerprint `EB48 3B26 B078 A4AA 1B6F 425E E21B 6950 A2EC B65C` ([key](https://trezor.io/security/satoshilabs-2021-signing-key.asc)); the 26.9.3 Windows signature was issued by this key on 2026-09-23 (signature packet inspected). The older 2020 key (`5406 7D8B BF00 5541 81B5 AB8F 26A3 A566 62F0 E7E2`) expired on 2021-01-01.

**Configuration.** User data in `%APPDATA%\@trezor\suite-desktop`. The main process keeps an electron-store `config.json` with `torSettings` (`running`, `port` 9050, `controlPort` 9051, `host`, `useExternalTor`, `externalPort`, `torDataDir`), `bridgeSettings` (`doNotStartOnStartup`, `usbImplementation`), `updateSettings`, `mcpSettings` and others ([store.ts](https://github.com/trezor/trezor-suite/blob/develop/suite/desktop-app-main/src/libs/store.ts)). **Custom back ends and wallet settings are in the renderer's storage**, not in that file, so BTCortex cannot pre-configure the node connection safely.

**Back ends and Tor.** Default: Trezor's Blockbook servers. Custom: Blockbook URL, or (desktop only — `isDesktop()` in [BackendTypeSelect.tsx](https://github.com/trezor/trezor-suite/blob/develop/packages/suite/src/components/suite/modals/ReduxModal/UserContextModal/AdvancedCoinSettingsModal/CustomBackends/BackendTypeSelect.tsx)) an Electrum server written `host:port:t` or `host:port:s` ([parseElectrumUrl.ts](https://github.com/trezor/trezor-suite/blob/develop/packages/utils/src/parseElectrumUrl.ts)), for example `127.0.0.1:50002:s` for a managed `fulcrum`. Bundled Tor (`bin/tor`), external Tor possible; `--tor` starts Suite with Tor enabled ([runtime flags](https://github.com/trezor/trezor-suite/blob/develop/docs/packages/desktop-app/runtime-flags.md)). There is no direct Bitcoin Core option, so a pruned node cannot back Suite.

**Built-in bridge.** Suite runs `@trezor/transport-bridge` (a "javascript clone of trezord-go") on **127.0.0.1:21328**, origin-restricted to trezor.io, sldev.cz, localhost and Trezor's onion, and starts it when no external bridge is running ([bridge.ts](https://github.com/trezor/trezor-suite/blob/develop/suite/desktop-app-main/src/modules/bridge.ts), [http.ts](https://github.com/trezor/trezor-suite/blob/develop/packages/transport-bridge/src/http.ts)). `--bridge-daemon` runs Suite without UI as a bridge for other apps.

**CoinJoin.** Discontinued for users in June 2024 when zkSNACKs' coordinator closed; [PR #33361](https://github.com/trezor/trezor-suite/pull/33361) (merged 2026-10-16) removed the affiliate server and dead coordinators ("wasabiwallet.io shut down in June 2024").

**Experimental MCP server.** Suite can expose an MCP server for AI agents at `http://127.0.0.1:21340/mcp` (token in the URL), off by default, with tools such as `trezor_send_transaction` (broadcast defaults to true) and `trezor_sign_message` ([mcp.md](https://github.com/trezor/trezor-suite/blob/develop/docs/packages/desktop-app/mcp.md)). BTCortex must never enable it or connect to it.

**Recommendation:** `external-launcher` (P2): verified download, per-user silent install, launch (optionally `--tor`), show the exact custom-back-end string for the user to paste.

### 8.3 Trezor Bridge, standalone (`trezor-bridge`)

Trezor's article "Deprecation and removal of standalone Trezor Bridge" says Trezor "has deprecated the standalone Trezor Bridge" and encourages users to uninstall it ([page metadata](https://trezor.io/deprecation-and-removal-of-standalone-trezor-bridge); the body was not retrievable). trezord-go's last release is v2.0.33 (2023-04-17); it served `http://localhost:21325` with AJAX limited to trezor.io origins ([README](https://github.com/trezor/trezord-go/blob/master/README.md)); licence LGPL-3.0 (COPYING). **Neither HWI nor Suite needs it.** BTCortex: `unsupported`; detect a listener on 127.0.0.1:21325 or an installed "Trezor Bridge" and recommend uninstalling it.

### 8.4 Ledger (`ledger`)

**At a glance** ([comparison](https://shop.ledger.com/pages/hardware-wallets-comparison), [Gen5 launch post 2025-10-23](https://www.ledger.com/blog-introducing-ledger-nano-gen5-ledger-wallet))

| Model | Connectivity | Secure element | Device OS targeted by Bitcoin app 2.5.1 | HWI 3.2.0 model string |
|---|---|---|---|---|
| Nano S Plus | USB-C (USB only) | ST33K1M5, CC EAL6+ | 1.6.1 | `ledger_nano_s_plus` |
| Nano X | USB-C, Bluetooth | CC EAL5+ | 2.7.1 | `ledger_nano_x` |
| Nano Gen5 ($179) | USB-C, Bluetooth, NFC | CC EAL6+ | `apex_p` 1.1.1 (inferred) | master only: `ledger_nano_gen5` (product ID 0x80) |
| Flex | USB-C, Bluetooth, NFC | CC EAL6+ | 1.6.1 | `ledger_flex` |
| Stax | USB-C, Bluetooth, NFC, Qi | CC EAL6+ | 1.10.1 | `ledger_stax` |
| Nano S (original) | USB | — | frozen at app 2.2.8 (OS 2.1.0) | `ledger_nano_s` |

**Bitcoin app.** Open-source [LedgerHQ/app-bitcoin](https://github.com/LedgerHQ/app-bitcoin) (renamed from app-bitcoin-new; Apache-2.0). Latest **2.5.1, 2026-09-09** ([CHANGELOG](https://github.com/LedgerHQ/app-bitcoin/blob/develop/CHANGELOG.md)). Capabilities: BIP-388 wallet policies ("accounts" in the UI since 2.2.4) with on-device registration returning an HMAC; miniscript in `wsh` and Taproot (Taproot miniscript since 2.2.0); `musig()` in Taproot policies (2.4.0); up to 15 cosigners (2.4.0); plain-language descriptions of multisig/Taproot policies at registration (2.5.0); non-standard sighash flags need a persistent setting (2.5.0); standard BIP-87 xpubs exported without confirmation (2.5.0). Unreleased on develop: BIP-322 message signing and a MuSig2 nonce change (one pending session per policy).

**Connection and Windows.** USB HID, vendor ID 0x2C97 (usage page 0xFFA0); no driver; Ledger requires 64-bit Windows 10/11 ([Nano S Plus page](https://shop.ledger.com/products/ledger-nano-s-plus)). The Bitcoin app must be open on the device. HWI uses the new protocol for app ≥ 2.1.0 (legacy client otherwise); single-signature signing only for standard BIP-44/49/84/86 paths; multisig is registered on the device during `signtx` when the PSBT carries the cosigners' global xpubs ([ledger.py](https://github.com/bitcoin-core/HWI/blob/master/hwilib/devices/ledger.py)). HWI master (2026-08-25, unreleased) lets callers pass a registered BIP-388 policy to `signtx`.

**Safely readable information.** Model (USB product ID), Bitcoin app name and version, master fingerprint and standard-path xpubs. Device OS version is only visible in Ledger Wallet.

**Security.** Closed-source OS; secure element. [Ledger Recover](https://shop.ledger.com/pages/ledger-recover): opt-in identity-verified subscription provided by Coincover; encrypted seed entropy split into three fragments held by Coincover, Ledger and EscrowTech (two needed); its 2023 announcement drew criticism because it showed the firmware can export seed material with user consent. [Ledger Connect Kit attack, 2023-12-14](https://www.ledger.com/blog/a-letter-from-ledger-chairman-ceo-pascal-gauthier-regarding-ledger-connect-kit-exploit): malicious npm versions 1.1.5–1.1.7 of a dApp library, about five hours; Ledger says devices and Ledger Live were not affected. [Customer database breach, 2020-06-25](https://www.ledger.com/addressing-the-july-2020-e-commerce-and-marketing-data-breach): about one million email addresses and 9 500 postal records; ongoing phishing risk. BTCortex should never mention Recover as a backup option and never accept recovery words.

**Recommendation:** `connected-application` (P2) via HWI; feasibility high.

### 8.5 Ledger Wallet, formerly Ledger Live (`ledger-live`)

- Renamed on 2025-10-23. Latest desktop **4.24.0, 2026-10-14** ([release](https://github.com/LedgerHQ/ledger-live/releases/tag/%40ledgerhq%2Flive-desktop%404.24.0)); `https://download.live.ledger.com/latest/win` redirects to `ledger-live-desktop-4.24.0-win-x64.exe`. MIT licence.
- Installer: electron-builder NSIS with **`perMachine: true`** (always all users, UAC elevation) and a directory chooser; Windows signing through `scripts/sign-windows.js` ([electron-builder.yml](https://github.com/LedgerHQ/ledger-live/blob/develop/apps/ledger-live-desktop/electron-builder.yml)). Unattended: `/S` from an elevated helper (not tested).
- **Verification without OpenPGP**: download `ledger-live-desktop-<v>.sha512sum` and `.sha512sum.sig` from `resources.live.ledger.app/public_resources/signatures/`; verify with `openssl dgst -sha256 -verify key.pem -signature <sums>.sig <sums>` against the secp256k1 key in [ledger-pubkey.ts](https://github.com/LedgerHQ/ledger-live/blob/develop/apps/ledger-live-desktop/src/main/updater/ledger-pubkey.ts) — **"Verified OK" for 4.24.0** on 2026-10-21; then compare SHA-512 (Windows: `654886b5…916d3`). BTCortex can implement the ECDSA check in-process.
- **No own-node option**: [SatStack](https://github.com/LedgerHQ/satstack) is archived (2025-06-01) and breaks with Ledger Live 2.53+. Ledger Wallet therefore cannot use the BTCortex-managed node; it is only a maintenance tool for Ledger OS and the Bitcoin app.
- **Recommendation:** `external-launcher` (P2).

### 8.6 Ledger SatStack (`ledger-satstack`)

Archived on 2025-06-01; last release v0.19.0 (2023-06-02) with Windows amd64/arm64/arm ZIPs; README: Ledger Live 2.44.0+ "but don't go as far 2.53+ that breaks satstack" ([README](https://github.com/LedgerHQ/satstack/blob/master/README.md)). `unsupported`; recorded so the catalogue can explain why Ledger Wallet cannot connect to a local node.

### 8.7 BitBox02 (`bitbox02`)

**At a glance.** Firmware **9.27.1, 2026-09-15** ([release notes in feed](https://github.com/BitBoxSwiss/bitbox02-firmware/releases.atom)): device info now reports the bootloader version; Bitcoin message signing with m/48' keys; upgrade path requires 9.17.1 and 9.26.2 as intermediate steps (the BitBoxApp does this automatically). Models: **BitBox02** (ATECC608B secure chip) and **BitBox02 Nova** (announced [2025-06-20](https://blog.bitbox.swiss/en/introducing-bitbox02-nova/); Infineon Optiga Trust M V3, EAL6+, glass OLED, Bluetooth LE "Whisper" on a DA14531 chip for iPhone/iPad only), each in Multi and Bitcoin-only editions ([product page](https://bitbox.swiss/bitbox02/)). Reproducible builds; firmware hashes shown at start-up are published per edition.

**Features** ([CHANGELOG](https://github.com/BitBoxSwiss/bitbox02-firmware/blob/master/CHANGELOG.md)): `wsh(<miniscript>)` policies (9.15.0, which also fixed a fee attack reported by Saleem Rashid); multisig at arbitrary keypaths (9.19.0); Taproot policies, miniscript on Taproot and sending to BIP-352 silent-payment addresses (9.21.0).

**HWI.** 3.2.0 added Nova; model strings `bitbox02_multi`, `bitbox02_btconly`, `bitbox02_nova_multi`, `bitbox02_nova_btconly` ([bitbox02.py](https://github.com/bitcoin-core/HWI/blob/3.2.0/hwilib/devices/bitbox02.py)). No legacy P2PKH inputs, no P2SH (non-segwit) multisig; multisig script configs are registered on the device when needed. **Pairing pitfall:** when HWI is driven by another program it cannot show the Noise pairing code and returns "Device not paired yet. Please pair using the BitBoxApp, then close the BitBoxApp and try again." The [support matrix](https://hwi.readthedocs.io/en/latest/devices/index.html) still marks BitBox02 Taproot as unsupported, but the driver handles p2tr at m/86' — the matrix is outdated.

**Safely readable information.** Firmware version, platform (BitBox02/Nova), edition, unlocked state, and (9.27.1+) bootloader version from the unencrypted info request; attestation result.

**Recommendation:** `connected-application` (P2), feasibility high.

### 8.8 BitBoxApp (`bitboxapp`)

- Latest **4.52.0, 2026-09-15** ([release](https://github.com/BitBoxSwiss/bitbox-wallet-app/releases/tag/v4.52.0)): bundles firmware 9.27.1; requires anti-klepto-capable firmware for signing; restricts local permissions on config files; mobile-only Lightning beta.
- Windows: `BitBox-4.52.0-win64-installer.exe`, NSIS with `RequestExecutionLevel admin`, `InstallDir $PROGRAMFILES64\BitBox`, executable `BitBox.exe` ([setup.nsi](https://github.com/BitBoxSwiss/bitbox-wallet-app/blob/master/frontends/qt/setup.nsi)). Unattended: `/S` from an elevated helper (standard NSIS; not tested).
- Verification: per-file `.asc` signed by "ShiftCrypto Security <security@shiftcrypto.ch>", fingerprint `DD09 E413 0975 0EBF AE0D EF63 5092 49B0 68D2 15AE` ([guide](https://support.bitbox.swiss/download-installation/verify-bitboxapp-signature); key at `bitbox.swiss/download/shiftcryptosec-509249B068D215AE.gpg.asc`); signature packet for 4.52.0 Windows checked (2026-09-11). SHA-256 values on [bitbox.swiss/download](https://bitbox.swiss/download/) (Windows `ab7db80c…abb56`).
- **Configuration (pre-configurable while closed)**: `%APPDATA%\bitbox\config.json` ([appdir.go](https://github.com/BitBoxSwiss/bitbox-wallet-app/blob/master/util/config/appdir.go), [arguments.go](https://github.com/BitBoxSwiss/bitbox-wallet-app/blob/master/backend/arguments/arguments.go), [config.go](https://github.com/BitBoxSwiss/bitbox-wallet-app/blob/master/backend/config/config.go)):

  ```json
  {
    "backend": {
      "proxy": { "useProxy": true, "proxyAddress": "127.0.0.1:9050" },
      "btc": { "electrumServers": [ { "server": "127.0.0.1:50002", "tls": true, "pemCert": "-----BEGIN CERTIFICATE-----\n…" } ] }
    }
  }
  ```

  Merge into the existing file (preserve all other keys, keep a backup) only when no `BitBox.exe` process runs. Replace the default `btc1…btc4.shiftcrypto.io:443` servers rather than appending: the app's own help says "If you do not remove the default servers, your own node will be added as a redundancy." Other files: `accounts.json`, `lightning.json`, `log.txt`, `bitbox02\`, `cache\`, `notes\`. Flags: `--testnet`, `--simulator`, `--simulatorPort`, `--gapLimitReceive`, `--gapLimitChange` ([server.go](https://github.com/BitBoxSwiss/bitbox-wallet-app/blob/master/frontends/qt/server/server.go)).
- Back end: Electrum protocol only — needs an unpruned Electrum server (`fulcrum`, `electrs`, `electrumx`). The in-app FAQ still recommends EPS and bwt, both incompatible with Bitcoin Core ≥ 30.
- BitBoxBridge 1.6.0 (localhost:8178) only serves web wallets such as MyEtherWallet ([README](https://github.com/BitBoxSwiss/bitbox-bridge/blob/master/README.md)); not needed.
- **Recommendation:** `connected-application` (P2; useful only where an Electrum server exists).

### 8.9 KeepKey (`keepkey`)

Firmware **v7.16.0 tagged 2026-10-16** (no notes); v7.14.3 is a Bitcoin-only build with reproducible-build instructions ([feed](https://github.com/keepkey/keepkey-firmware/releases.atom)). Companion app **KeepKey Vault 1.6.4 (2026-10-20)**, `KeepKey-Vault-1.6.4-win-x64-setup.exe` with `SHA256SUMS-windows.txt` (no signature file seen); the older keepkey-desktop repository was archived on 2026-09-25. No secure element. HWI: xpub, message signing, setup/wipe/recovery, segwit and multisig inputs, on-screen display, **no Taproot**. `connected-application`, P3.

### 8.10 BitBox01 / Digital Bitbox (`bitbox01`)

End of sale 2019-11-12, no active updates after November 2020, 2FA relay shutdown announced for mid-2023, last BitBoxApp with full support 4.37.3 ([EOL FAQ](https://guides.shiftcrypto.ch/bitbox01/eol-faqs/), [blog 2023-01-18](https://blog.bitbox.swiss/en/the-end-of-the-road-for-the-bitbox01/)). Screenless, so addresses and transactions cannot be verified on the device. `unsupported`; detection plus migration advice only.

---

## 9. Air-gapped, smartcard and other signing devices

### 9.1 Air-gapped and other signing devices: cross-cutting facts

- **Every device here signs PSBTs that a coordinator builds.** None of them needs BTCortex to hold keys. BTCortex's role is discovery (USB devices only), watch-only import of xpubs and descriptors, PSBT hand-off (file, QR or HWI), combination and finalisation, and broadcast after explicit confirmation. Signing always happens on the device after the user approves it there.
- **Three air-gap transports matter:**
  1. **microSD or USB storage files.** COLDCARD naming is `<name>.psbt` in, then `<name>-part.psbt` (multisig not yet complete), `<name>-signed.psbt` and `<name>-final.txn`, or `<txid>.txn`.
  2. **Animated UR QR codes** ([BCR-2020-005](https://github.com/BlockchainCommons/Research/blob/master/papers/bcr-2020-005-ur.md); `crypto-psbt`, `crypto-account`, `crypto-hdkey`, `crypto-output`). Used by Jade, Passport, Keystone, SeedSigner and Krux.
  3. **BBQr.** The COLDCARD Q relies on it. SeedSigner (0.8.7) and Krux also decode it.

  Specter DIY instead shows plain base64 PSBT QR codes and strips the signed PSBT down to its signatures.
- **QR flows need a webcam on Windows** and an animated-QR encoder and decoder in BTCortex, or delegation to Sparrow.
- **Multisig registration formats differ by device:**
  - The COLDCARD text format (`Name:`, `Policy: M of N`, `Format:`, `Derivation:`, then `XFP: xpub` lines) is accepted by COLDCARD. Jade accepts it too, as `multisig_file` in `register_multisig`.
  - BIP-380 descriptors: COLDCARD, Krux, Specter DIY, Jade.
  - BIP-388 wallet policies with miniscript: Jade `register_descriptor`, up to 16.
  - BSMS (BIP-129): COLDCARD EDGE only, as a preview.
  - Passport Prime accepts `crypto-output` URs.
- **HWI covers only COLDCARD and Jade in this group.** Passport, Keystone, SeedSigner, Krux and Specter DIY have no HWI driver. TAPSIGNER and Satochip are screenless smartcards driven over PC/SC by Sparrow.
- **HWI's future is limited.** HWI issue [#850](https://github.com/bitcoin-core/HWI/issues/850) (2026-08-18, maintainer achow101) announces:
  - a feature freeze and no new device support;
  - minimal maintenance after the MuSig2 work, with the following release "likely the final release of HWI".

  [BHWI](https://github.com/wizardsardine/bhwi) (Rust, BSD-3-Clause, "[WIP]", no releases, pushed 2026-10-19) is suggested as a successor. HWI master (unreleased) has `registerdescriptor` and `--registration` for BIP-388 policies, which 3.2.0 lacks.

### 9.2 COLDCARD (`coldcard`)

**At a glance**

- **Models.** Mk4 and Mk5 run the same firmware image ([Mk5 page](https://coldcard.com/docs/coldcard-mk5/)). The Q adds a QWERTY keyboard, a QR scanner, two microSD slots, NFC and AAA power ([Q overview](https://coldcard.com/docs/coldcard-q/)). Mk3 and Mk2 are on their final release 4.2.0, and Mk1 on 3.0.6 ([downloads](https://coldcard.com/downloads/)).
- **Latest firmware** ([ChangeLog](https://github.com/Coldcard/firmware/blob/master/releases/ChangeLog.md)):
  - Standard track: **5.6.3** (Mk4/Mk5) and **1.5.3Q** (Q), both 2026-09-30. They add Codex32 and Shamir backups and stricter PSBTv2 parsing.
  - Previous releases: 5.6.2/1.5.2Q (2026-09-03) and 5.6.1/1.5.1Q (2026-08-20) ([History-Mk](https://github.com/Coldcard/firmware/blob/master/releases/History-Mk.md), [History-Q](https://github.com/Coldcard/firmware/blob/master/releases/History-Q.md)).
  - EDGE track: **6.6.1X/6.6.1QX**, file names dated 2026-08-31 in [signatures.txt](https://github.com/Coldcard/firmware/blob/master/releases/signatures.txt).
  - The latest master commit is dated 2026-10-09. GitHub Releases are not used.

> **Security incident, July 2026.** Weak device-generated entropy let attackers regenerate private keys offline and steal funds ([advisory](https://blog.coinkite.com/coldcard-mk3-seed-generation-warning/), [security status](https://coldcard.com/security/status)).
>
> **Affected seeds**
> - Mk2/Mk3 firmware 4.0.1–4.1.9 (most severe).
> - Seeds made on Mk4/Mk5 before 5.6.0, on Q before 1.5.0Q, and on EDGE before 6.6.0X/6.6.0QX (about 72 bits instead of 128).
>
> **Remedy**
> - Updating does **not** repair a seed. Migrate to a new seed unless 50 or more fair, private dice rolls were added.
> - TAPSIGNER, OPENDIME and SATSCARD are unaffected.
> - Recommended firmware: 5.6.3 and 1.5.3Q.
>
> **What BTCortex should do**
> - Show this advisory whenever a COLDCARD is detected or chosen.
> - Show the minimum fixed release per track.
> - Never suggest that BTCortex can "check" a seed. An xpub does not reveal which firmware created the seed.

**Connections and Windows**

- **microSD** must be FAT32 or FAT12.
- **USB** uses the HID-based COLDCARD protocol ([ckcc-protocol](https://github.com/Coldcard/ckcc-protocol/blob/master/PROTOCOL.md)). Link-encryption v1 is the legacy default. v3 (authenticated) is opt-in from 5.6.2/1.5.2Q and ckcc-protocol 1.6.0 (2026-09-08), so HWI's older client should keep working (not tested).
- **Virtual Disk** emulates a 4 MB USB disk on Windows.
- **NFC** works on Mk4, Mk5 and Q.
- **QR/BBQr is on the Q only.** It scans PSBTs (Base64 or hex), xpubs, BIP-21 URIs, multisig definitions and BBQr up to 2 MiB ([QR scanner](https://coldcard.com/docs/qr-scanner/)). UR is not mentioned.
- No vendor driver is documented for Windows. Coinkite documents download verification with Gpg4win/Kleopatra and `certutil -hashfile` ([upgrade](https://coldcard.com/docs/upgrade)).

**HWI**

- **Supported** ([matrix](https://hwi.readthedocs.io/en/latest/devices/index.html)): xpub retrieval, message signing, backup, legacy/segwit single-sig inputs, P2SH, P2SH-P2WSH and P2WSH multisig inputs, and display on the device.
- **Not available:** setup, wipe or recovery through software. Taproot inputs are not marked as supported.
- **Unreleased on master:** PR [#849](https://github.com/bitcoin-core/HWI/pull/849) (2026-08-20) adds EDGE handling and Taproot address display.

**PSBT, multisig and miniscript**

- **Signed-file naming** comes from the firmware's [auth.py](https://github.com/Coldcard/firmware/blob/master/shared/auth.py):
  - incomplete multisig: `<name>-part.psbt`;
  - complete: `<name>-signed.psbt` plus `<name>-final.txn` (hex);
  - complete, with the input file deleted after signing: `<txid>.txn`.
- **Multisig:** up to 15 co-signers on P2SH, P2WSH and P2SH-P2WSH. Imports accept the COLDCARD text format or BIP-380 descriptors from SD, Virtual Disk, QR or NFC ([multisig](https://coldcard.com/docs/multisig/)).
- **Descriptor export** ([descriptor export](https://coldcard.com/docs/descriptor_export/)):
  - Formats: "pretty", bare, and Bitcoin Core `importdescriptors`.
  - The Core export uses `"timestamp": "now"` and `"range": [0, 100]`. BTCortex should substitute the wallet birthday when it is known, and on pruned nodes respect the prune height.
- **EDGE** (preview track, "not qualified and tested to the same standard"):
  - Taproot since 6.0.0X; miniscript and MiniTapscript since 6.1.0X.
  - [BSMS](https://coldcard.com/docs/bsms/) works as coordinator or signer, with files `bsms_*.token`, `bsms_sr1*.dat/.txt` and `bsms_cr2*.dat/.txt`.
  - Coinkite names AnchorWatch, Liana and Keeper as miniscript coordinators ([EDGE 6.3.5](https://blog.coinkite.com/edge-635/)).

**Safely readable information**

- Over HWI `enumerate`: model, path and fingerprint.
- With ckcc: `version` (firmware version and date), `chain` (BTC or XTN) and `xfp`.
- BTCortex must never call `ckcc pass` (passphrase), never use HSM mode or CKBunker, and never trigger `backup`.

**Verification**

- `signatures.txt` is clear-signed by key `4589779ADFC14F3327534EA8A3A31BAD5A2A5B10`. Coinkite's Windows section names its owner as Peter D. Gray (DocHex on Keybase). The issuer of the 2026-09-30 signature was confirmed by parsing the signature.
- The device only installs factory-signed firmware: the red CAUTION LED stays on until the user runs "Bless Firmware", then the green GENUINE LED shows.

**Licence:** MIT with the Commons Clause (source-available). Do not redistribute the firmware.

**Pitfalls**

- A cut power supply during the 15-second flash write can damage a Mk4.
- Mark 1 devices must not receive firmware newer than 3.0.6.
- EDGE and standard version numbers are **separate tracks**: a higher EDGE number is not necessarily fixed.

### 9.3 Blockstream Jade (`jade`)

**At a glance**

- **Models** ([README](https://github.com/Blockstream/Jade/blob/master/README.md)):
  - Jade 1.0 (wheel) and Jade 1.1 (rocker);
  - Jade Plus (`jade_v2`: camera, battery, buttons);
  - Jade Core (`jade_v2c`: Jade Plus without camera and battery), [launched 2026-04-28](https://blockstream.com/press-releases/2026-04-28-blockstream-introduces-jade-core/).
- **Lineup and prices** ([Blockstream, 2026-06-02](https://blog.blockstream.com/the-jade-lineup-reimagined/)): Classic $79, Core $99, Plus from $149.
- **Firmware 1.0.41 (2026-08-22)** is a security release: "All users should upgrade as soon as possible". It adds anti-downgrade protection, stack protection and extra per-device entropy ([CHANGELOG](https://github.com/Blockstream/Jade/blob/master/CHANGELOG.md)). The latest commit is dated 2026-10-16.

**Connections and Windows**

- **USB is a serial (COM) port, not HID.** Blockstream's [Windows troubleshooting](https://help.blockstream.com/blockstream-jade/troubleshooting/fix-issues-connecting-jade-via-usb) offers the WCH driver and the Silicon Labs CP210x Universal Windows Driver without saying which model needs which.
- HWI matches these USB IDs ([jade_serial.py](https://github.com/bitcoin-core/HWI/blob/master/hwilib/devices/jadepy/jade_serial.py)): `10c4:ea60` (Silicon Labs), `1a86:55d4` and `1a86:7523` (WCH), `0403:6001` (FTDI), `303a:4001` and `303a:1001` (Espressif, ESP32-S3).
- **Only one program can hold the COM port.** Close Sparrow or the Blockstream app before HWI uses it.
- **Bluetooth LE** is used by the Blockstream app.
- **QR mode** carries Bitcoin only. Its UR types ([qrmode.c](https://github.com/Blockstream/Jade/blob/master/main/qrmode.c)) are `crypto-psbt`, `crypto-account`/`crypto-hdkey` and `bytes`, plus Jade-specific PIN types.
- **USB storage host on ESP32-S3 models.** They can sign PSBT files and load firmware from an attached SD-card reader, writing a new file instead of overwriting the input.

**PIN server**

- Unlocking needs the companion to relay requests to the blind PIN server: `https://jadepin.blockstream.com/get_pin` by default, or the onion service `http://mrrxtq6tjpbnbm7vh5jt6mpjctn7ggyfy5wegvbeff3x7jrznqawlmid.onion/get_pin`.
- A self-hosted PIN server can be set with `update_pinserver` ([RPC docs](https://github.com/Blockstream/Jade/blob/master/docs/index.rst)).
- Privacy: whoever relays the request reveals their IP address to the PIN server. Route it over Tor in privacy profiles.
- HWI's Jade client performs this exchange ([jade.py](https://github.com/bitcoin-core/HWI/blob/master/hwilib/devices/jade.py)).

**HWI**

- **3.2.0 added** Jade Plus support and native PSBT signing ([release](https://github.com/bitcoin-core/HWI/releases/tag/3.2.0)).
- **Supported** ([matrix](https://hwi.readthedocs.io/en/latest/devices/index.html)): all legacy and segwit single-sig and multisig inputs, including bare multisig and arbitrary scripts.
- **Not available:** Taproot inputs, and setup, wipe or backup through software.
- **Jade Core** shipped after HWI 3.2.0; recognition by 3.2.0 is untested.

**Multisig and miniscript**

- `register_multisig` stores up to 16 configurations and accepts the COLDCARD text format.
- `register_descriptor` stores up to 16 BIP-388 miniscript wallet policies, for example Liana's timelocked recovery.
- Wallets are locked to MAIN or TEST networks.

**Safely readable information**

`get_version_info` returns JADE_VERSION, BOARD_TYPE, JADE_CONFIG, JADE_FEATURES, IDF_VERSION, EFUSEMAC, BATTERY_STATUS, JADE_STATE (UNINIT, UNSAVED, LOCKED, READY, TEMP), JADE_INTERFACE (NONE, QR, SERIAL, BLE), JADE_NETWORKS and JADE_HAS_PIN. None of it is secret. Show JADE_STATE and JADE_NETWORKS in diagnostics.

**Verification**

- Official units only accept Blockstream-signed OTA firmware.
- `index.json` per hardware type publishes `cmphash` and `fwhash` (`jadefw.blockstream.com/bin/jade|jade1.1|jade2.0/index.json`). The device displays the fwhash before installing. Builds are reproducible ([FWUPDATE.md](https://github.com/Blockstream/Jade/blob/master/FWUPDATE.md)).
- ESP32-S3 units support RSA-4096 attestation.

**Licence:** MIT.

### 9.4 Foundation Passport (`passport`)

**At a glance**

- **Passport Core** is discontinued (no longer produced) but still updated ([glossary](https://docs.foundation.xyz/glossary/home/)):
  - Latest stable: **2.3.11** (release page dated "12 Dec"; beta-1 2025-12-02). It adds a Bull Bitcoin flow and blocks wrong-model update files ([release](https://github.com/Foundation-Devices/passport2/releases/tag/v2.3.11)).
  - **2.4.0 betas** (2026-03-27 to 2026-10-15) add miniscript.
- **Passport Prime** runs KeyOS. **KeyOS 1.3.0** was published 2026-07-17 ([blog](https://foundation.xyz/blog/keyos-version-1-3-0-is-now-available)). It followed a third-party audit and adds `crypto-output` multisig import for Sparrow, a universal QR scanner and seed import into the Vault.

**Connections and Windows**

- **Passport Core** uses only the camera (UR 2.0 animated QR) and microSD. Its USB-C port is power-only: "data pins … simply not present" ([device features](https://docs.foundation.xyz/passport/device-features/)).
- **Passport Prime** pairs with **Envoy** (mobile only) over QuantumLink (Bluetooth). With other wallets it uses QR codes or files ([Prime connect](https://docs.foundation.xyz/prime/connect/)). Foundation says Core integrations do not automatically carry over to Prime.
- No HWI support.

**Coordinators** ([Core connect](https://docs.foundation.xyz/passport/connect/))

- Documented step by step: Sparrow, Specter Desktop, Nunchuk and Keeper.
- Listed without steps: Bitcoin Core, Bitcoin Safe, BlueWallet, Casa, Electrum, Fully Noded, Zeus and Simple Bitcoin Wallet.

**Verification**

- Passport Core only accepts firmware signed by at least two team members (the `cosign` tool).
- Builds are reproducible: strip the signatures from the release binary and compare hashes ([REPRODUCIBILITY.md](https://github.com/Foundation-Devices/passport2/blob/main/REPRODUCIBILITY.md)).
- Release notes publish SHA-256 and MD5 hashes. Assets are `v<ver>-passport.bin` and `v<ver>-founders-passport.bin`.

**Licence:** GPL-3.0-or-later for passport2. The KeyOS licence was not verified.

### 9.5 Keystone (`keystone`)

**At a glance**

- **Keystone 3 Pro:** 4-inch touchscreen, camera, fingerprint sensor, three secure elements and microSD, priced at $149 ([product page](https://keyst.one/shop/products/keystone-3-pro)).
- **Firmware 3.1.4** (2026-10-16) ships in three editions: Web3, **BTC Only** and Cypherpunk ([release](https://github.com/KeystoneHQ/keystone3-firmware/releases/tag/3.1.4)). Release 2.9.11 is an intermediate firmware for devices below 2.0.0.

**Connections**

- Data moves by animated UR QR and FAT32 microSD.
- Keystone's guide says a USB connection to software wallets is "coming soon" ([guide](https://guide.keyst.one/docs/connecting-software-wallets-to-keystone)).
- No HWI support.

**Coordinators**

- **BTC Only firmware:** Sparrow (1.8.5 or later with firmware 1.0.1-BTC or later; 1.8.4 or later for Taproot), BlueWallet and Nunchuk ([Sparrow guide](https://guide.keyst.one/docs/sparrow)).
- **Multisig:** needs V1.1.0-BTC or later. Import Sparrow's "Keystone Multisig" export by QR or microSD ([multisig guide](https://guide.keyst.one/docs/btc-multisig)).

**Verification**

- Release notes give the firmware SHA-256 and source SHA-256 for each edition. The device shows its firmware hash.
- A Docker reproducible build is documented ([verify.md](https://github.com/KeystoneHQ/keystone3-firmware/blob/master/docs/verify.md)).
- No OpenPGP signatures are published.

**Licence:** MIT text, copyright YANSSIE HK LIMITED.

**Recommendation:** use the BTC Only edition. The Web3 edition is outside BTCortex's scope.

### 9.6 SeedSigner (`seedsigner`)

**At a glance**

- **Latest release: 0.8.7** "Summer of SeedSigner", published 2026-07-08 (signature created 2026-07-07). It adds BBQr PSBT decoding, 22 languages and direct xpub QR format selection ([release](https://github.com/SeedSigner/seedsigner/releases/tag/0.8.7)).
- The dev branch is active (2026-10-20). v0.9.0 and a microcontroller port are announced.

**Hardware**

- A Raspberry Pi Zero v1.3 is recommended because it has no Wi-Fi or Bluetooth. Other Pi models also work.
- It needs a Waveshare 1.3-inch 240x240 LCD HAT and an OV5647 camera ([README](https://github.com/SeedSigner/seedsigner/blob/dev/README.md)).

**Workflow and features**

- QR only: UR PSBTs in and out, and xpub export for single-sig and multisig.
- Taproot single-sig, native and nested segwit, and legacy addresses.
- PSBT review with change verification, an address explorer and message signing.
- Miniscript is not listed among the features.
- **Coordinators:** Sparrow, Nunchuk, Keeper, BlueWallet and Specter Desktop.

**Verification**

- `seedsigner.<ver>.sha256.txt` is signed (`.sig`) with key `46739B74B56AD88F14B0882EC7EF709007260119` ([Keybase seedsigner](https://keybase.io/seedsigner)). The issuer was confirmed from the 0.8.7 signature.
- Images have been reproducible since 0.7.0.
- On Windows, write the image with Balena Etcher or Raspberry Pi Imager.

**BTCortex boundary:** never create, show or scan SeedQR or SettingsQR codes.

### 9.7 Krux (`krux`) and Krux Installer (`krux-installer`)

**Krux v26.09.0** (2026-10-03)

- It is the first release by the new maintainer jdlcdl ([release](https://github.com/selfcustody/krux/releases/tag/v26.09.0)).
- The Kendryte **K210 platform is discontinued** by its manufacturer.
- **Boards:** M5StickV, Maix Amigo/Dock/Cube/Bit, Yahboom, WonderMV, TZT CanMV, Embed Fire and WonderK PRO ([CHANGELOG](https://github.com/selfcustody/krux/blob/main/CHANGELOG.md)).

**Features**

- **Transport:** QR codes in UR, BBQr and pMofN formats, and SD-card PSBT signing that keeps all fields, so devices can sign in turn.
- **Multisig:** P2WSH, P2SH-P2WSH and P2SH.
- **Scripts:** Taproot and wsh miniscript since 25.03.0.
- **Descriptors:** loading a descriptor sets the wallet attributes.
- **Coordinators** ([docs](https://github.com/selfcustody/krux/blob/main/docs/getting-started/usage/setting-a-coordinator-and-signing.en.md)): Sparrow, Specter Desktop, Liana and Bitcoin Safe on desktop; Nunchuk, BlueWallet and Keeper on mobile.

**Security**

- No secure element. Mnemonics can be stored encrypted in the KEF format.
- 24.11.1 fixed AES-CBC initialisation-vector misuse.
- 26.09.0 fixed a 12-byte GCM tag overflow, rated non-critical.

**Firmware verification**

- `SHA256SUMS` is signed in two ways ([ATTESTATION.txt](https://github.com/selfcustody/krux/releases/download/v26.09.0/ATTESTATION.txt)):
  - by the **selfcustody ECDSA key** (`.sig`, DER; `selfcustody.pem` is in the repository);
  - by the maintainer's OpenPGP key (`.asc`; issuer `6DC76DC81B5C35D7F432712945D7F41053AF05F3`).
- Builds are reproducible.

**Krux Installer v0.0.24** (2026-10-03)

- **Files:** `krux-installer_v0.0.24_Setup.exe`, plus `.deb`, `.rpm` and an arm64 `.dmg` ([release](https://github.com/selfcustody/krux-installer/releases/tag/v0.0.24)).
- **Not Authenticode-signed.** SmartScreen shows "Windows protected your PC" ([Windows doc](https://github.com/selfcustody/krux/blob/main/docs/getting-started/installing/from-gui/windows.en.md)).
- **Verifying the download:** `krux-installer_0.0.24.SHA256.txt.asc` is signed by primary key `C43B4A5325273ABA93A8EED5B38829728980AA8B`, "qlrd <qlrddev@proton.me>". The signing subkey is `71EBF2D7F1D79C992F3BEC39E27261CF60497DD8`; key resolved on [keys.openpgp.org](https://keys.openpgp.org/vks/v1/by-fingerprint/C43B4A5325273ABA93A8EED5B38829728980AA8B).
- **How firmware is checked:** the installer embeds firmware verified at build time and checks a hash table before flashing. No signature is checked at flash time ([README](https://github.com/selfcustody/krux-installer/blob/main/README.md)).
- **Not documented:** the installer technology and its silent switches.
- **Recommended support level:** `external-launcher` only. BTCortex never flashes devices.

### 9.8 Specter DIY (`specter-diy`)

**v1.10.5** (2026-09-06) is a maintenance release. It hardens the RNG (rejects dead TRNG output) and change detection ([release](https://github.com/cryptoadvance/specter-diy/releases/tag/v1.10.5)). The last commit is dated 2026-10-07, so the project is **active, not stale**.

**Hardware:** an STM32F469 Discovery board with a QR scanner.

**Communication** ([communication.md](https://github.com/cryptoadvance/specter-diy/blob/master/docs/communication.md))

- **QR:** base64 PSBT in. The signed PSBT is stripped to its partial signatures, so the coordinator must combine it with the original.
- **USB:** plain-text commands (`fingerprint`, `xpub <path>`, `sign <psbt>`).
- **SD card:** `.psbt` and `.txt` files.
- Miniscript (wsh) is supported without policy compilation ([descriptors.md](https://github.com/cryptoadvance/specter-diy/blob/master/docs/descriptors.md)).

**Verification**

- The secure bootloader checks two signatures.
- v1.10.3 rotated the bootloader keys, so devices on v1.9.0 or earlier must install v1.10.3 first.
- `sha256.signed.txt` is signed by Mike Tolkachev, key `F2DBC4C614C113E2B15F879ADD5C1264EBD645BE`; the issuer was confirmed.

**Recommendation:** `research-only` (P3) because of its own QR conventions.

### 9.9 TAPSIGNER (`tapsigner`) and Satochip (`satochip`)

**Shared trait:** both are **screenless smartcards**. The host computes what is signed, so the PC running the wallet is the only verification point. Sparrow supports "the Tapsigner, Satschip, Satochip and Keycard" through a card reader and advises small to medium amounts ([Sparrow docs](https://www.sparrowwallet.com/docs/airgapped-wallet-smartcard.html)).

**TAPSIGNER** ([tapsigner.com](https://tapsigner.com/))

- **What it does:** signs digests over NFC.
- **Backups:** an AES-128-CTR encrypted XPRV backup; the key is printed on the card. There is no restore-to-card command.
- **Wallets:** Nunchuk, Cove, Bitcoin Keeper and Sparrow.
- **Desktop use:** needs a USB CCID reader. Coinkite recommends the HID Omnikey CL5022 CL for Windows, Linux and macOS ([coinkite-tap-proto](https://github.com/coinkite/coinkite-tap-proto/blob/master/README.md)).
- The `cktap` CLI (1.2.2, 2023) requires pyscard.
- Not affected by the COLDCARD RNG incident.

**Satochip**

- **Applet v0.16-0.1** (pre-release, 2026-10-16) fixes a 2FA bypass in MuSig2 finalisation and a non-compliant BIP-341 tweak. Its API changes break older clients ([releases](https://github.com/Toporin/SatochipApplet/releases)). Licence: AGPL-3.0.
- **Electrum:** upstream Electrum has **no** Satochip plugin; its plugins are bitbox02, coldcard, digitalbitbox, jade, keepkey, ledger, safe_t and trezor ([plugins](https://github.com/spesmilo/electrum/tree/master/electrum/plugins)). Satochip support in Electrum comes from Satochip's own fork.
- **Satochip-Utils v0.4.0-beta:** a single Windows `…-win-amd64-…-signed.exe` with no published checksums.

**Recommendation:** `research-only` (P3) for both. Document the Sparrow path only.

### 9.10 Frostsnap (`frostsnap`)

**v0.4.0** (2026-08-25)

- Fixes a malicious-app attack that could get a device to sign an output hidden from its screen.
- Fixes change addresses that fell outside the recovery scan range.
- Blocks firmware downgrades ([release](https://github.com/frostsnap/frostsnap/releases/tag/v0.4.0)).

**Devices:** ESP32-C3 boards, daisy-chained over USB-C, costing 150,000 sats each ([frostsnap.com](https://frostsnap.com/)). They have no PIN and no secure element.

**Windows app**

- `Frostsnap-v0.4.0.zip` is the portable x64 Flutter release folder ([release.yml](https://github.com/frostsnap/frostsnap/blob/master/.github/workflows/release.yml)).
- Each file has an `.asc` signature from "Frostsnap <security@frostsnap.com>": primary key `F19CCCCD876B6E57FB712206A9D5981F42B0EA50`, signing subkey `A0D99F559A2E20CFE6D18ABDFE2521845E568DAE`.

**How it signs:** FROST threshold Taproot, not PSBT multisig, so the app is the only coordinator. It uses Electrum servers.

**Recommendation:** `research-only` (P3).

---

## 10. Standards

Records: [`../data/standards-wallets-hardware.json`](../data/standards-wallets-hardware.json) (38 entries). Statuses are copied from the BIP headers in [bitcoin/bips](https://github.com/bitcoin/bips) on 2026-10-21. The repository now follows BIP 3, so older BIPs show the new terms (`Deployed`, `Complete`, `Draft`, `Closed`). BIP 340–342 are in `standards-full-nodes-core.json`. BIP 352, 375 and 392 (silent payments) belong to `privacy-networking`, and BIP 353 to `lightning`.

| Standard | Title | Status (2026-10-21) | Used by BTCortex for |
|---|---|---|---|
| [BIP 174](https://github.com/bitcoin/bips/blob/master/bip-0174.mediawiki) | Partially Signed Bitcoin Transaction Format (v1.4.4) | Deployed | PSBT creation, parsing, validation, combination, finalisation, file/QR/HWI exchange |
| [BIP 370](https://github.com/bitcoin/bips/blob/master/bip-0370.mediawiki) | PSBT Version 2 | Deployed | Version detection and conversion; Core 32.0 default |
| [BIP 371](https://github.com/bitcoin/bips/blob/master/bip-0371.mediawiki) | Taproot Fields for PSBT | Deployed | Taproot input and output inspection |
| [BIP 373](https://github.com/bitcoin/bips/blob/master/bip-0373.mediawiki) | MuSig2 PSBT Fields | Complete | MuSig2 PSBT inspection |
| [BIP 327](https://github.com/bitcoin/bips/blob/master/bip-0327.mediawiki) | MuSig2 for BIP340-compatible Multi-Signatures (v1.0.4) | Deployed | Displaying MuSig2 wallets (no own signing) |
| [BIP 328](https://github.com/bitcoin/bips/blob/master/bip-0328.mediawiki) | Derivation Scheme for MuSig2 Aggregate Keys | Complete | MuSig2 address derivation |
| [BIP 379](https://github.com/bitcoin/bips/blob/master/bip-0379.md) | Miniscript | Draft | Policy analysis (spending paths, timelocks) |
| [BIP 380](https://github.com/bitcoin/bips/blob/master/bip-0380.mediawiki)–[385](https://github.com/bitcoin/bips/blob/master/bip-0385.mediawiki) | Output Script Descriptors (general, non-SegWit, SegWit, multisig, combo, raw/addr) | Deployed | Checksum validation, inspection, watch-only import |
| [BIP 386](https://github.com/bitcoin/bips/blob/master/bip-0386.mediawiki) | tr() Output Script Descriptors | Deployed | Taproot descriptors |
| [BIP 387](https://github.com/bitcoin/bips/blob/master/bip-0387.mediawiki) | Tapscript Multisig Output Script Descriptors | Deployed | multi_a/sortedmulti_a inspection |
| [BIP 388](https://github.com/bitcoin/bips/blob/master/bip-0388.mediawiki) | Wallet Policies for Descriptor Wallets (v1.1.0) | Complete | Hardware-wallet policy registration |
| [BIP 389](https://github.com/bitcoin/bips/blob/master/bip-0389.mediawiki) | Multipath Descriptor Key Expressions | Draft | `<0;1>` receive/change descriptors |
| [BIP 390](https://github.com/bitcoin/bips/blob/master/bip-0390.mediawiki) | musig() Descriptor Key Expression (v0.2.0) | Draft | MuSig2 descriptors |
| [BIP 129](https://github.com/bitcoin/bips/blob/master/bip-0129.mediawiki) | Bitcoin Secure Multisig Setup (BSMS) | Complete | Verifying multisig setup records |
| [BIP 329](https://github.com/bitcoin/bips/blob/master/bip-0329.mediawiki) | Wallet Labels Export Format | Draft | Label export and import |
| [BIP 138](https://github.com/bitcoin/bips/blob/master/bip-0138.md) | Compact Encryption Scheme for Non-seed Wallet Data (v0.1.3) | Draft | Candidate encrypted descriptor backups |
| [BIP 21](https://github.com/bitcoin/bips/blob/master/bip-0021.mediawiki) | URI Scheme | **Closed** (proposed replacement: BIP 321) | Legacy URI parsing |
| [BIP 321](https://github.com/bitcoin/bips/blob/master/bip-0321.mediawiki) | URI Scheme | Complete | URI generation and parsing (spec 14) |
| [BIP 173](https://github.com/bitcoin/bips/blob/master/bip-0173.mediawiki) / [BIP 350](https://github.com/bitcoin/bips/blob/master/bip-0350.mediawiki) | bech32 / bech32m | Deployed / Deployed | Address decoding and validation |
| [BIP 32](https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki) | Hierarchical Deterministic Wallets | Deployed | xpub import, fingerprints, key origins |
| [BIP 44](https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki), [49](https://github.com/bitcoin/bips/blob/master/bip-0049.mediawiki), [84](https://github.com/bitcoin/bips/blob/master/bip-0084.mediawiki), [86](https://github.com/bitcoin/bips/blob/master/bip-0086.mediawiki) | Single-signature derivation schemes | Deployed | Default paths for hardware-wallet import |
| [BIP 48](https://github.com/bitcoin/bips/blob/master/bip-0048.mediawiki) | Multi-Script Hierarchy for Multi-Sig Wallets | Deployed | Multisig xpub defaults (1' P2SH-P2WSH, 2' P2WSH; no Taproot type) |
| [BIP 87](https://github.com/bitcoin/bips/blob/master/bip-0087.mediawiki) | Hierarchy for Deterministic Multisig Wallets | Complete | Accepting alternative multisig paths |
| [BIP 67](https://github.com/bitcoin/bips/blob/master/bip-0067.mediawiki) | Deterministic P2SH multisig addresses through public key sorting | Complete | sortedmulti() semantics |
| [BIP 322](https://github.com/bitcoin/bips/blob/master/bip-0322.mediawiki) | Generic Signed Message Format (v2.0.0) | Complete | Ownership proofs (verification needs a library; Core lacks it) |
| [SLIP-0132](https://github.com/satoshilabs/slips/blob/master/slip-0132.md) | Registered HD version bytes for BIP-0032 | Active | ypub/zpub/Ypub/Zpub to xpub plus descriptor conversion |
| [BCR-2020-005](https://github.com/BlockchainCommons/Research/blob/master/papers/bcr-2020-005-ur.md) | Uniform Resources (UR) (v2.1.0) | Multiple Implementations (two stars) | Animated-QR transport |
| [BCR-2020-006](https://github.com/BlockchainCommons/Research/blob/master/papers/bcr-2020-006-urtypes.md) | Registry of UR Types (revised 2025-04-26) | Multiple Implementations (two stars) | Accepted UR payload types |
| [BBQr](https://github.com/coinkite/BBQr/blob/master/BBQr.md) | BBQr - Better Bitcoin QR | "Deployed Widely" | Animated-QR transport (COLDCARD Q and others) |

### (a) PSBT version 0 and version 2 in practice

- **Bitcoin Core 31.1 creates and parses only version 0** ([doc/psbt.md](https://github.com/bitcoin/bitcoin/blob/v31.1/doc/psbt.md) mentions no v2). The reference implementation of BIP 370, [PR #21283](https://github.com/bitcoin/bitcoin/pull/21283), was **merged on 2026-05-05**. The [32.0 release notes draft](https://github.com/bitcoin-core/bitcoin-devwiki/wiki/32.0-Release-Notes-Draft) says that "`createpsbt`, `walletcreatefundedpsbt`, `converttopsbt`, and `psbtbumpfee` will now default to creating version 2 PSBTs" and adds an optional `psbt_version` argument. On 2026-10-21 [bitcoincore.org/bin/bitcoin-core-32.0/](https://bitcoincore.org/bin/bitcoin-core-32.0/) contains only `test.rc2` to `test.rc4`, so 32.0 is unreleased. The same draft adds `exportwatchonlywallet` (export a watch-only copy of a descriptor wallet, restorable with `restorewallet`), `addhdkey` and `derivehdkey` (an xpub at a hardened path for multisig coordination). All three are useful to the wallet wizard once 32.0 ships.
- **HWI 3.2.0** parses and serialises both versions and has `convert_to_v0`/`convert_to_v2` helpers and the BIP 373 MuSig2 fields ([hwilib/psbt.py](https://github.com/bitcoin-core/HWI/blob/3.2.0/hwilib/psbt.py)).
- **Sparrow** has used PSBTv2 as its default internal representation since 2.4.0, but writes version 0 for BIP 322 PSBT QR and file exports since 2.5.0 ([release feed](https://github.com/sparrowwallet/sparrow/releases.atom)). Its drongo library parses both versions ([PSBT.java](https://github.com/sparrowwallet/drongo/blob/master/src/main/java/com/sparrowwallet/drongo/psbt/PSBT.java)).
- **Electrum (master; latest release 4.8.2 of 2026-09-11) accepts only version 0** and raises "Only PSBTs with version 0 are supported. Found version: …". It parses only `PSBT_IN_TAP_KEY_SIG` and `PSBT_IN_TAP_MERKLE_ROOT` from BIP 371 ([transaction.py](https://github.com/spesmilo/electrum/blob/master/electrum/transaction.py), [RELEASE-NOTES](https://github.com/spesmilo/electrum/blob/master/RELEASE-NOTES)).
- **COLDCARD** has supported PSBTv2 since Mk4 firmware 5.2.0 (2023-10-10) and on the Q, with parsing hardening in 2026 ([History-Mk.md](https://github.com/Coldcard/firmware/blob/master/releases/History-Mk.md), [History-Q.md](https://github.com/Coldcard/firmware/blob/master/releases/History-Q.md)). The **Ledger** Bitcoin app's `SIGN_PSBT` takes "a PSBTv2"; host libraries convert ([doc/bitcoin.md](https://github.com/LedgerHQ/app-bitcoin-new/blob/master/doc/bitcoin.md)). **Jade** signs PSBTs natively (HWI 3.2.0 "Jade native PSBT signing"). Its changelog mentions v0 signing, and v2 acceptance was not verified ([CHANGELOG](https://github.com/Blockstream/Jade/blob/master/CHANGELOG.md)).
- **Consequence for BTCortex**: the PSBT inspector must show the version. The wizard must pass `psbt_version=0` to Core 32+ when the next hop is Electrum or another v0-only tool. Converting v2 to v0 is only appropriate once the transaction is fully constructed, because v0 cannot express the modifiable flags (inference from BIP 370, not tested).

### (b) Descriptor and miniscript support in Bitcoin Core 31.1

From [doc/bips.md](https://github.com/bitcoin/bitcoin/blob/v31.1/doc/bips.md) and [doc/descriptors.md](https://github.com/bitcoin/bitcoin/blob/v31.1/doc/descriptors.md) at v31.1:

- BIP 380–385: since 0.17.0 ("most of Script Expressions"). BIP 386 `tr()`: 22.0. BIP 387 `multi_a`/`sortedmulti_a`: 24.0.
- BIP 389 multipath `<0;1>`: [PR #22838](https://github.com/bitcoin/bitcoin/pull/22838), milestone 29.0. It is missing from `bips.md` but documented in `descriptors.md`, whose multisig walkthrough imports "a single multipath descriptor" into a blank watch-only wallet.
- BIP 390 `musig()`: parsing since 30.0, signing since 31.0, only inside `tr()`. BIP 327/328: 30.0 (signing 31.0).
- BIP 379 miniscript: partial in 24.0, full in 26.0, inside `wsh()` and `tr()`.
- BIP 371 Taproot PSBT fields: 24.0. BIP 373 MuSig2 PSBT fields: 30.0.
- Checksums: `importdescriptors` and `deriveaddresses` require them; `getdescriptorinfo` computes them. The checksum always detects up to 4 errors in descriptors of up to 501 characters.
- **BIP 322 is not implemented**: `verifymessage` returns "Address does not refer to key" for anything but P2PKH ([signmessage.cpp](https://github.com/bitcoin/bitcoin/blob/v31.1/src/common/signmessage.cpp)).
- Devices: Ledger Bitcoin app 2.1.0 (SegWit miniscript), 2.2.0 (Taproot miniscript), 2.4.0 (`musig()`), 2.5.0 (clear-text policy display), 2.5.1 (latest, 2026-09-09) ([CHANGELOG](https://github.com/LedgerHQ/app-bitcoin-new/blob/master/CHANGELOG.md)). BitBox02 firmware 9.15.0 (`wsh()` miniscript policies) and 9.21.0 (Taproot policies, MiniTapscript, sending to BIP 352 addresses) ([CHANGELOG](https://github.com/BitBoxSwiss/bitbox02-firmware/blob/master/CHANGELOG.md)). Liana master (15.0.0) builds on rust-miniscript 12.0 ([Cargo.toml](https://github.com/wizardsardine/liana/blob/master/Cargo.toml)). Sparrow 2.5.5 rejects Taproot descriptors with a script tree.

### (c) UR and BBQr for animated QR

- **UR** ([BCR-2020-005](https://github.com/BlockchainCommons/Research/blob/master/papers/bcr-2020-005-ur.md), v2.1.0): dCBOR payloads encoded as Bytewords, `ur:<type>/<seqNum>-<seqLen>/…` frames with a CRC-32, and fountain codes so frames can arrive in any order.
  - Types ([BCR-2020-006](https://github.com/BlockchainCommons/Research/blob/master/papers/bcr-2020-006-urtypes.md)): `psbt` (40310), `output-descriptor` (40308), `account-descriptor` (40311). The older `crypto-psbt`, `crypto-output` and `crypto-account` are deprecated, but readers must still accept them.
  - Verified implementations: Sparrow's [hummingbird](https://github.com/sparrowwallet/hummingbird/blob/master/src/main/java/com/sparrowwallet/hummingbird/registry/RegistryType.java) (both generations), Krux (bc-ur C module, [README](https://github.com/selfcustody/krux/blob/main/README.md)), SeedSigner ([decode_qr.py](https://github.com/SeedSigner/seedsigner/blob/dev/src/seedsigner/models/decode_qr.py): UR2 PSBT/output/account, plus Specter's legacy PSBT QR, Base64, Base43 and BBQr).
  - Jade's QR mode uses `crypto-psbt`, `crypto-account`/`crypto-hdkey` and `bytes` ([qrmode.c](https://github.com/Blockstream/Jade/blob/master/main/qrmode.c)); Passport and Keystone document animated UR QR (§9.4, §9.5); Caravan has a BC-UR 2 keystore (§7.4) and Bitcoin-Safe reads and writes UR and BBQr (§7.6).
- **BBQr** ([spec](https://github.com/coinkite/BBQr/blob/master/BBQr.md)): an 8-character header `B$` + encoding (`H`/`2`/`Z`) + type (`P` PSBT, `T` transaction, `J`, `C`, `U`, `B`, `X`) + two base-36 digits for the total and two for the index. It allows up to 1295 frames and Z-mode zlib compression with wbits=10.
  - The [README](https://github.com/coinkite/BBQr/blob/master/README.md) (verified by Coinkite on 2026-07-27) lists COLDCARD Q, Sparrow, Nunchuk Desktop, BTCPay Server, Krux, Bitcoin Safe, Ashigaru Desktop (a Sparrow derivative) and several mobile wallets. SeedSigner decodes only (from 0.8.7).
- **Electrum's release notes mention neither UR nor BBQr.** Electrum 4.8.x shows PSBT QR codes in its own base43 format; the 4.9 plan ([#10989](https://github.com/spesmilo/electrum/issues/10989)) moves to BC-UR 2.0 animated QR, not BBQr.
- **BTCortex** should support both transports in its QR module and auto-detect the format (`ur:` or `B$` prefix). It must reject seed-bearing UR types and cap decompressed BBQr size before inflating.

### (d) Multisig registration: BIP 388 wallet policies and BIP 129 BSMS

- **They solve different steps.** BIP 129 is a setup protocol. A Coordinator collects signed key records (`BSMS 1.0`, TOKEN, KEY with origin, description, BIP 322 or legacy signature) and returns a descriptor record. Each Signer checks that its key is present and that the first address matches. Encryption is optional: PBKDF2-SHA512, AES-256-CTR and HMAC-SHA256, with a 64-bit or 128-bit TOKEN.
- **BIP 388 is the on-device storage and verification model.**
  - The device shows a descriptor template with `@n` placeholders and the key list once. The user approves on the device. Stateless devices return a proof of registration: the Ledger app returns a 32-byte HMAC-SHA256 the host must keep, and losing it means registering again.
  - Implementations named in the BIP: Ledger app ≥ 2.1.0, BitBox02 ≥ 9.15.0, Jade ≥ 1.0.24 (via libwally-core 1.0.0), BTCPay Server ≥ 2.1.1 (subset) and NBitcoin.
  - HWI master merged "Optionally pass BIP388 policy to signtx" on 2026-08-25. No HWI release contains it yet; 3.2.0 is from 2026-02-10.
- **Sparrow imports BSMS records** with header and first-address validation (2.5.0 to 2.5.5).
- **BTCortex rules:**
  - Registration is always a visible, user-confirmed device action, never automatic.
  - Store proofs of registration as wallet metadata.
  - Before exposing a receive address, verify the first address on every cosigner (or show it for comparison).
  - Keep `multi` and `sortedmulti` distinct.

### (e) BIP 329 label format essentials

- **File format:** UTF-8 JSON Lines, one object per line, separated by `\n`, no multi-line values.
- **Required keys:** `type` and `ref`.
  - Types: `tx` (txid), `addr`, `pubkey` (32, 33 or 65 bytes, hex), `input` and `output` (`txid:index`), `xpub` and `spscan` (a silent-payments scan key expression as in BIP 392).
- **Optional keys:** `label`, `origin` and `spendable`.
  - `origin` is an abbreviated descriptor such as `wpkh([d34db33f/84'/0'/0'])` that tells accounts apart.
  - `spendable` appears only on `output` records.
- **Optional extra fields:** `height` (omit until 6 confirmations), `time` (ISO-8601), `fee`, `value` (signed sats), `rate`, `keypath`, `fmv` (per-currency map) and `heights`.
- **Import rules:** importers ignore unknown types and records they do not store, and may truncate labels (255 characters suggested). If `label` or `spendable` is omitted, the importer leaves the existing value unchanged.
- **Privacy:** the BIP warns that exports are privacy-sensitive and that unencrypted exports "should be deleted as soon as possible".
- **Implementations:** the reference implementation is [python-bip329](https://github.com/Labelbase/python-bip329). Sparrow, whose author wrote the BIP, imports and exports the format; since 2.5.3 it writes `spendable` only as `false` for frozen coins. Liana exports BIP 329 since 10.0 (`getlabelsbip329`; §7.2) and Bitcoin-Safe imports and exports it (§7.6); Specter Desktop (PR #2712) and Electrum (PR #8614) have open pull requests. Electrum uses its own non-self-describing label JSON, per the BIP's own motivation section.

### Other notes

- **BIP 21 to BIP 321.** BIP 21 is `Closed`; [BIP 321](https://github.com/bitcoin/bips/blob/master/bip-0321.mediawiki) is its compatible successor. It adds case-insensitive keys, bech32/bech32m addresses, empty-address URIs, the `lightning`, `lno`, `pay` and `sp` parameters, and `pop` callbacks that must not open web-capable schemes. Electrum parses URIs in [bip21.py](https://github.com/spesmilo/electrum/blob/master/electrum/bip21.py).
- **BIP 138** (Draft, assigned 2026-05-11, from Wizardsardine). It encrypts descriptors and wallet policies with ChaCha20-Poly1305, using a key derived from the sorted public keys, so any cosigner can decrypt with their xpub. Liana master depends on the `bip138` crate. It is a candidate format for BTCortex descriptor backups without seeds.
- **SLIP-0132 prefixes.** Electrum ([constants.py](https://github.com/spesmilo/electrum/blob/master/electrum/constants.py)) and Sparrow ([ExtendedKey.java](https://github.com/sparrowwallet/drongo/blob/master/src/main/java/com/sparrowwallet/drongo/ExtendedKey.java)) both use ypub/zpub/Ypub/Zpub. Convert them to xpub and an explicit descriptor before passing anything to Bitcoin Core.
- **BIP 48 has no Taproot script type.** Sparrow's defaults are `m/48'/0'/0'/2'` (P2WSH) and `m/48'/0'/0'/1'` (P2SH-P2WSH) ([ScriptType.java](https://github.com/sparrowwallet/drongo/blob/master/src/main/java/com/sparrowwallet/drongo/protocol/ScriptType.java)). HWI's `getdescriptors` uses purposes 44/49/84/86 ([key.py](https://github.com/bitcoin-core/HWI/blob/3.2.0/hwilib/key.py)).

---

## 11. Recommended support levels and rationale

| Entry | Recommended | Priority | Rationale |
|---|---|---|---|
| `sparrow` | `fully-managed` | P1 | Signed portable ZIP, documented JSON config, network flag, direct pruned-Core mode; no API, so wallet operations stay in Sparrow |
| `electrum` | `fully-managed` | P1 | Signed standalone/portable executables, documented config and non-persistent command-line overrides; useful only with an Electrum server |
| `hwi` | `fully-managed` | P1 | Signed portable ZIP invoked as a short-lived subprocess; upstream is winding down, so keep it behind an adapter |
| `specter-desktop` | `connected-application` | P2 | Verifiable specterd ZIP and node files writable while stopped, but internal formats, upkeep-only maintenance and no upstream Core 30/31 testing |
| `liana` | `connected-application` | P2 | Standalone EXE; wallet profiles come from Liana's own installer, after which BTCortex can re-wire `daemon.toml` while Liana is closed |
| `nunchuk` | `external-launcher` | P2 | Portable ZIP, but settings live in undocumented registry values; CI-held signing key; bundles an HWI fork |
| `bitcoin-safe` | `connected-application` | P2 | Signed portable EXE; works with compact block filters out of the box; config format must be validated before any write |
| `wasabi-wallet` | `fully-managed` | P2 | Signed ZIP and documented, non-persistent start-up parameters; BTCortex must never choose a coordinator |
| `caravan` | `external-launcher` | P3 | Browser app; local hosting needs a CORS proxy (a later `connected-application`) |
| `blockstream-app` | `external-launcher` | P3 | Admin-only installer; own back end only for single-signature wallets with an Electrum server |
| `bitcoin-keeper` | `research-only` | P3 | Mobile wallet; the desktop companion's signing key is not identified |
| `trezor-suite` | `external-launcher` | P2 | Needed for firmware and Safe 7 pairing; back-end settings are not in an editable file |
| `ledger-live` | `external-launcher` | P2 | Maintenance tool for Ledger OS and the Bitcoin app; no own-node option |
| `bitboxapp` | `connected-application` | P2 | `config.json` can be pre-written while closed; needs an Electrum server; pairing tool for HWI |
| `coldcard` | `connected-application` | P2 | HWI over USB plus documented microSD and QR formats; must surface the 2026 entropy advisory |
| `trezor` | `connected-application` | P2 | HWI for One, T, Safe 3 and Safe 5; the Safe 7 only through Sparrow, Electrum ≥ 4.8.0 or Suite |
| `ledger` | `connected-application` | P2 | HWI with the Bitcoin app open; BIP388 registration on the device |
| `bitbox02` | `connected-application` | P2 | HWI including Nova; first pairing in the BitBoxApp |
| `jade` | `connected-application` | P2 | HWI over USB serial and UR QR mode; PIN-server privacy to manage |
| `passport` | `connected-application` | P2 | UR QR and microSD only; needs BTCortex's QR module or Sparrow |
| `keystone` | `connected-application` | P2 | UR QR and microSD; recommend the BTC Only firmware |
| `seedsigner` | `connected-application` | P2 | QR only; BTCortex must never generate or scan SeedQR |
| `krux` | `connected-application` | P3 | QR and SD; K210 hardware discontinued by its manufacturer |
| `krux-installer` | `external-launcher` | P3 | Unsigned flasher; BTCortex never flashes devices itself |
| `specter-diy` | `research-only` | P3 | Own QR conventions (signed PSBT stripped to signatures) |
| `keepkey` | `connected-application` | P3 | HWI support; no Taproot |
| `tapsigner`, `satochip` | `research-only` | P3 | Screenless smartcards; document the Sparrow path only |
| `frostsnap` | `research-only` | P3 | FROST threshold signing, not PSBT; its app is the only coordinator |
| `bhwi` | `research-only` | P3 | No releases; track as the HWI replacement |
| `trezor-bridge`, `ledger-satstack`, `bitbox01`, `whirlpool-gui` | `unsupported` | P3 | Deprecated, archived, end-of-life or seized |
| `armory`, `lily-wallet`, `ashigaru-terminal` | `research-only` | P3 | Stale, or unverifiable distribution and legal context; detection only |

---

## 12. Windows-specific pitfalls

1. **Bitcoin Core data directory.** Core 28+ defaults to `%LOCALAPPDATA%\Bitcoin` but keeps an existing `%APPDATA%\Bitcoin`. Sparrow suggests both; Specter (autodetect) and Liana (cookie pre-fill) assume `%APPDATA%\Bitcoin`. Always write the exact path.
2. **One process per device.** A USB interface or COM port (Jade) can be held by only one process. Close Trezor Suite (internal bridge on 127.0.0.1:21328), BitBoxApp, Ledger Wallet, the Blockstream App and Sparrow before HWI runs. Sparrow polls USB every 30 s.
3. **Jade drivers.** Jade uses a USB-serial bridge (Silicon Labs CP210x or WCH CH34x/CH9102 IDs). Blockstream offers both drivers without saying which model needs which.
4. **Installers that need administrator rights:** Electrum setup, BitBoxApp, Ledger Wallet (per-machine), Blockstream App, Nunchuk installer, Bitcoin-Safe setup and the Wasabi MSI. Portable alternatives exist for Sparrow (ZIP), Electrum (standalone and portable), HWI (ZIP), Nunchuk (ZIP), Wasabi (ZIP), Bitcoin-Safe (portable EXE), Liana (EXE) and Specter (specterd ZIP). Use them for zero-touch installs.
5. **URI-handler and file-association conflicts.** The Sparrow MSI (`bitcoin:`, `lightning:`, `auth47:`, `.psbt`, `.txn`, `.asc`), the Electrum installer (`bitcoin:`, `lightning:`, `lnurlp:`, `lnurlw:`) and the Bitcoin-Safe installer (`bitcoin:`) all register handlers; the last installer wins. Portable installs avoid this.
6. **HKCU writes from elevated installers.** Under over-the-shoulder elevation they land in the administrator's registry hive, so detection keys can be missing for the actual user.
7. **SmartScreen and missing code signatures.** Liana, Nunchuk and Krux Installer are documented or configured as unsigned. Sparrow, HWI and Specter were not checked. Electrum, Trezor Suite, Wasabi and Bitcoin-Safe are Authenticode-signed per their documentation.
8. **Antivirus false positives** on PyInstaller executables: Electrum (the download page warns), HWI and specterd.
9. **Command-line length** (about 32 KB): pass PSBTs to HWI with `--stdin`; hand PSBTs to Sparrow and Electrum as files.
10. **Configuration rewritten by running applications.** Sparrow rewrites the whole config on every setter; Specter rewrites `config.json` at start-up; Wasabi holds `.wasabi-lock`; the Blockstream App writes with a debounce and on exit. Edit only after confirming that no process runs.
11. **Sparrow's AF_UNIX lock socket** (`sparrow.lock`) needs Windows 10 1803 or later (Sparrow targets Windows 10+). A stale file is removed automatically.
12. **Network marker files** (`network-testnet`, `network-testnet4`, `network-signet`) silently override Sparrow's `-n`.
13. **Windows on ARM.** There are no arm64 builds of Sparrow, Electrum, HWI or Wasabi; x64 emulation is untested.
14. **JSON escaping and paths with spaces.** Windows paths in JSON need doubled backslashes. Write files with a JSON serialiser, never by string concatenation.
15. **Electrum's installer wipes its install folder** before copying and aborts silently if Electrum is running.
16. **Webcam QR scanning.** Sparrow's FAQ says Windows webcams can fail when "two Microsoft libraries the webcam driver depends on" are missing.
17. **The test machine runs Electrum 4.7.2 from Program Files.** A newer standalone copy sharing `%APPDATA%\Electrum` upgrades wallet files; upgrade the installed copy instead.

---

## 13. Security considerations

- **Seeds and signing.**
  - No flow in this document needs a seed.
  - Every application that can hold software keys has a hot-wallet path BTCortex must never use or suggest: Sparrow software wallets, Electrum standard wallets, Specter's "Bitcoin Core (hot wallet)", Liana hot signers (`mnemonic-*.txt`), Nunchuk software keys, Wasabi and the Blockstream App.
  - Signing and broadcasting are separate, explicit user actions. Watch-only wallets are labelled as such everywhere.
- **Release verification.** Pin fingerprints, not expiry dates.

  | Project | Signer and fingerprint | Expiry |
  |---|---|---|
  | Sparrow | Craig Raw `D4D0 D320 2FC0 6849 A257 B38D E946 1833 4C67 4B40` | 2027-09-18 |
  | HWI | Ava Chow `1528 1230 0785 C964 44D3 334D 1756 5732 E08E 5E41` | 2027-08-21 |
  | Electrum | ThomasV and SomberNight's release key | No expiry; Emzy's signing subkey expired 2026-10-12 |
  | Wasabi | zkSNACKs `6FB3 872B 5D42 292F 5992 0797 8563 4832 8949 861E` | 2028-02-24 |
  | Specter | "Specter Signer 2026" `9DC3 3CA8 3058 9DE3 B322 5C26 EEF5 756B 2EA4 2349` | Expect yearly rotation |
  | Trezor Suite | SatoshiLabs 2021 `EB48 3B26 B078 A4AA 1B6F 425E E21B 6950 A2EC B65C` | — |
  | BitBoxApp | `DD09 E413 0975 0EBF AE0D EF63 5092 49B0 68D2 15AE` | — |

  - Ledger Wallet uses a secp256k1 signature over SHA-512 sums instead of OpenPGP.
  - Nunchuk's checksum signature is produced by a CI-held key, so it attests the pipeline, not a developer.
- **Advisories to surface** (dated, from the entries):
  - COLDCARD seed entropy (July 2026): affected seeds must be migrated; firmware updates do not fix them.
  - Electrum: 4.7.2 medium-severity plugin authorisation bypass (GHSA-vw94-r84p-66qf); 4.8.0 CVE-2012-2459 SPV fix; 4.7.1 malicious translation strings.
  - Jade 1.0.41 security release (2026-08-22).
  - Trezor firmware fixes 2.10.0, 2.11.0 and 2.12.2, and the TROPIC01 disclosure (Trezor response 2026-06-03).
  - Ledger: the Recover controversy and the 2023 Connect Kit supply-chain attack.
  - Satochip applet 0.16 (2FA bypass in MuSig2 finalisation); Krux 26.09.0 (GCM tag overflow); Frostsnap 0.4.0 (hidden-output signing attack).
  - Specter 2.1.7 and 2.1.11 web-security fixes.
- **Privacy defaults to override or disclose:**
  - Public Electrum servers: Electrum's automatic server selection and Sparrow's offline-mode default.
  - Vendor default servers: the BitBoxApp (Shift servers), Nunchuk (its own Electrum server), Caravan (mempool.space), Bitcoin-Safe (Blockstream servers per its privacy statement, or random compact-block-filter peers), Wasabi (mempool.space for fees and rates, plus a user-chosen coordinator).
  - Blockstream's multisig back end.
  - Jade's PIN-server requests (IP address); HWI relays them over clearnet.
- **Secrets in configuration files:**
  - Sparrow `coreAuth` (only with USERPASS);
  - Specter node passwords;
  - Nunchuk registry passwords;
  - Bitcoin-Safe `rpc_password`;
  - Electrum `rpcpassword` and `proxy_password`;
  - Wasabi `JsonRpcPassword` and `BitcoinRpcCredentialString`.

  Prefer cookie authentication locally and dedicated `rpcauth` users with `rpcwhitelist` remotely. Redact these keys in diagnostics.
- **Dangerous optional features BTCortex must never enable:**
  - Trezor Suite's experimental MCP server (it can request signing);
  - Wasabi's JSON-RPC wallet methods;
  - Electrum's daemon RPC wallet commands;
  - HWI `setup`, `wipe`, `restore`, `backup` and passphrase options;
  - Specter's hot-wallet device.
- **Chain safety.** Wallets that use Bitcoin Core as their source of truth trust the node's chain: Sparrow in Core mode (verified in source; merkle proofs are skipped because "the node answering is the user's own"), and by the same design Specter, Liana, Nunchuk in Core mode, Caravan with a private node and Wasabi's RPC source (inference, not checked per wallet). Pointed at a Bitcoin Knots ≥ 29.4.1 node they would follow Knots' hard-forked chain. The wizard must refuse that combination unless the user explicitly chose it.
- **Supply chain.**
  - Do not reuse third-party copies of `hwi.exe` (Nunchuk bundles a fork).
  - Download only from the official release locations listed in the entries.
  - Verify inner executable hashes where they are published (HWI).

---

## 14. Open questions

1. Authenticode status of `Sparrow.exe`/MSI, `hwi.exe` and `specterd.exe`. Check with `Get-AuthenticodeSignature` after a verified download in Phase 2.
2. Sparrow MSI: default per-user install folder, `msiexec /qn` behaviour, upgrade over older versions and uninstall cleanliness.
3. Does the official HWI Windows binary bundle Python `requests`? This decides whether HWI contacts the Jade PIN server over clearnet.
4. Are the official Bitcoin Core 31.1 Windows binaries built with external-signer support?
5. Timing and scope of HWI's announced final release, and when BHWI publishes signed releases with Windows support. Decide whether BTCortex's signer adapter targets BHWI, vendor libraries or Sparrow-only delegation in Phase 6.
6. Will Fulcrum and electrs add Electrum protocol 1.7 before Electrum 4.9 makes it mandatory? Until then, pin Electrum to 4.8.x for local servers.
7. Will Sparrow support silent-payment scanning with Bitcoin Core (Core-side SP indexing), or will SP wallets always need `frigate`?
8. UX decision: pre-set Sparrow's `mode: "ONLINE"` (true zero-touch) or let Sparrow's Welcome flow show the pre-filled settings once?
9. Wasabi's cookie credential format (`cookiefile=<path>`) and whether it re-reads a rotated cookie. Test before relying on it.
10. Specter Desktop 2.1.11 against Bitcoin Core 31.1 (pruned and unpruned): an integration test is needed before the spec-8 flow is marked supported.
11. Nunchuk's registry key names and group prefixes; Bitcoin-Safe's and the Blockstream App's exact Windows config paths. These were inferred from source and must be observed on a test install.
12. Trezor Suite: does a documented way to pre-configure a custom Electrum back end exist (for example a start-up flag)?
13. Keeper Desktop's release signing key; Liana's checksum-signing key (USAGE.md names Edouard Paris's key, but the 15.0 signature issuer was not checked).
14. Which BBQr/UR encoder and decoder libraries BTCortex adopts (developer-tools-libraries scope), and their behaviour with Sparrow's 1295-part cap and Electrum's base43.
15. Migration path for the test machine's existing Electrum 4.7.2 wallets to a pruned-node setup. It is impossible without an archival node or an external Electrum server unless the history is newer than the prune height.

---

## 15. Sources

All sources were accessed on 2026-10-21. Primary sources are linked inline throughout. The JSON records carry the full per-entry source lists. Key documents:

- Sparrow: [2.5.5 release](https://github.com/sparrowwallet/sparrow/releases/tag/2.5.5), [releases feed](https://github.com/sparrowwallet/sparrow/releases.atom), [download page](https://sparrowwallet.com/download/), [connect to Bitcoin Core](https://sparrowwallet.com/docs/connect-node.html), [FAQ](https://sparrowwallet.com/docs/faq.html), [Config.java](https://github.com/sparrowwallet/sparrow/blob/2.5.5/src/main/java/com/sparrowwallet/sparrow/io/Config.java), [BitcoindClient.java](https://github.com/sparrowwallet/sparrow/blob/2.5.5/src/main/java/com/sparrowwallet/sparrow/net/cormorant/bitcoind/BitcoindClient.java), [SparrowWallet.java](https://github.com/sparrowwallet/sparrow/blob/2.5.5/src/main/java/com/sparrowwallet/sparrow/SparrowWallet.java), [Storage.java](https://github.com/sparrowwallet/sparrow/blob/2.5.5/src/main/java/com/sparrowwallet/sparrow/io/Storage.java), [ApplicationDir.java](https://github.com/sparrowwallet/drongo/blob/e1c26413e4973752c9d7d43e37e39b411f21b48c/src/main/java/com/sparrowwallet/drongo/ApplicationDir.java), [Lark README](https://github.com/sparrowwallet/lark/blob/master/README.md), [issue #1874](https://github.com/sparrowwallet/sparrow/issues/1874), [issue #1840](https://github.com/sparrowwallet/sparrow/issues/1840).
- Electrum: [download page](https://electrum.org/), [RELEASE-NOTES](https://github.com/spesmilo/electrum/blob/4.8.2/RELEASE-NOTES), [simple_config.py](https://github.com/spesmilo/electrum/blob/4.8.2/electrum/simple_config.py), [commands.py](https://github.com/spesmilo/electrum/blob/4.8.2/electrum/commands.py), [electrum.nsi](https://github.com/spesmilo/electrum/blob/4.8.2/contrib/build-wine/electrum.nsi), [pubkeys](https://github.com/spesmilo/electrum/tree/4.8.2/pubkeys), [issue #10989](https://github.com/spesmilo/electrum/issues/10989).
- HWI: [3.2.0 release](https://github.com/bitcoin-core/HWI/releases/tag/3.2.0), [support matrix](https://hwi.readthedocs.io/en/latest/devices/index.html), [3.2.0 CLI](https://hwi.readthedocs.io/en/3.2.0/usage/cli-usage.html), [issue #850](https://github.com/bitcoin-core/HWI/issues/850), [issue #775](https://github.com/bitcoin-core/HWI/issues/775), [Bitcoin Core external-signer.md](https://github.com/bitcoin/bitcoin/blob/v31.1/doc/external-signer.md), [external_signer.cpp](https://github.com/bitcoin/bitcoin/blob/v31.1/src/external_signer.cpp), [BHWI README](https://github.com/wizardsardine/bhwi/blob/master/README.md).
- Other wallets, devices and standards: see §7–§10 and the `sources` arrays in the JSON records.
