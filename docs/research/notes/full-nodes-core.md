# Bitcoin Core and Bitcoin Knots — technical reference (scope `full-nodes-core`)

Verified on **2026-10-21**. Records: [`../data/full-nodes-core.json`](../data/full-nodes-core.json) (entries `bitcoin-core`, `bitcoin-knots`) and [`../data/standards-full-nodes-core.json`](../data/standards-full-nodes-core.json) (28 standards).

This is the reference the engineers will build the Bitcoin Core adapter from. Every statement below was checked against a primary source fetched on the verification date (release directories, release notes, source code at the release tag, official documentation, the Knots release notes). Where something could not be verified it says so. Source code is cited at tag `v31.1` unless stated otherwise.

Projects owned by other scopes are referred to by canonical id only: `tor`, `i2pd`, `cjdns`, `hwi`, `gpg4win`, `sparrow`, `fulcrum`, `electrs`, `electrumx`, `lnd`, `core-lightning`, `btcpay-server`, `nbxplorer`, `stratum-v2-reference-implementation`, `datum-gateway`, `mutinynet`.

---

## 0. Key facts at a glance

| Item | Bitcoin Core | Bitcoin Knots |
|---|---|---|
| Latest stable | **31.1**, announced 2026-07-08 ([release page](https://bitcoincore.org/en/releases/31.1/)) | **29.4.2.knots20260508**, published 2026-09-21 ([release](https://github.com/bitcoinknots/bitcoin/releases/tag/v29.4.2.knots20260508)) |
| Next | 32.0 in release-candidate phase: rc1 2026-09-14 … rc4 2026-10-12; target date was 2026-10-10 ([issue #35122](https://github.com/bitcoin/bitcoin/issues/35122)) | Release notes announce further changes "around mid-October and 2027 August"; no newer tag on 2026-10-21 |
| Windows assets | `bitcoin-31.1-win64-setup.exe` (NSIS, Authenticode-signed), `bitcoin-31.1-win64.zip` (signed portable), unsigned and debug variants; **x64 only** | `…-win64-setup-pgpverifiable.exe`, `…-win64-pgpverifiable.zip`; **not Authenticode-signed**; x64 only |
| Minimum Windows | Windows 10 version 1903 (31.x and 32.0 notes); "Windows 10+" (29.x/30.x) | "Windows 10+" |
| Default data directory | `%LOCALAPPDATA%\Bitcoin` since 28.0, but an existing `%APPDATA%\Bitcoin` is kept | Identical logic and paths (shared with Core) |
| Verification | SHA256SUMS + SHA256SUMS.asc (8–16 builder signatures on recent releases), keys in [bitcoin-core/guix.sigs](https://github.com/bitcoin-core/guix.sigs) | SHA256SUMS + .asc (3–7 signatures), keys in [bitcoinknots/guix.sigs](https://github.com/bitcoinknots/guix.sigs/tree/knots/builder-keys) |
| Consensus | SHA256d Bitcoin chain | **Since 29.4.1.knots20260508: BLAKE2b proof-of-work hard fork at height 961640 plus BIP110 rules — a different chain from Bitcoin Core** |
| Licence | MIT | MIT |

**Contradictions with the specification's assumptions** (detailed in §12 and §14):

1. The specification treats Bitcoin Knots as a Core-compatible alternative implementation (sections 5.1, 23, Phase 5). Since 2026-09-02 (29.4.1.knots20260508) Knots validates a hard-forked chain; Knots and Core nodes are no longer interchangeable backends.
2. Spec section 15 lists a "Stratum v2 template provider" style mining interface among current Core features: the IPC mining interface exists, but **not in Windows builds** (no `bitcoin-node.exe`).
3. Running Bitcoin Core "as a Windows service" (spec 17.1) is not supported upstream; there is no service mode and `-daemon` is rejected on Windows.
4. With the zero-touch requirement and the test machine (5.9 GB RAM, ~76 GB free), a mainnet node **must be pruned**, which rules out `txindex`, Electrum servers and historical wallet rescans (§6.7).

---

## 1. Release lines, lifecycle and where to look

### 1.1 Maintained versions (lifecycle page, fetched 2026-10-21)

[bitcoincore.org/en/lifecycle](https://bitcoincore.org/en/lifecycle/): "We always maintain the latest three major versions… Major versions that are 'End of Life' do not generally receive security fixes." Majors are numbered `MAJOR.0`, maintenance releases `MAJOR.MINOR`, release candidates suffixed `rcN`. The project aims for a major release every 6–7 months; consensus changes are shipped first in maintenance releases.

| Line | First release | End of life | Latest point release | Notes |
|---|---|---|---|---|
| 32.x | TBA (rc4 2026-10-12) | after v35.0 | — | Release-candidate cycle |
| **31.x** | 2026-04-19 | after v34.0 | **31.1 (2026-07-08)** | Current stable |
| 30.x | 2025-10-10 | after v33.0 | 30.3 (2026-07-08) | 30.0 and 30.1 binaries withdrawn (§11) |
| 29.x | 2025-04-14 | after v32.0 | 29.4 (announced 2026-07-13; GitHub release 2026-07-10) | Becomes end of life when 32.0 ships |
| 28.x | 2024-10-02 | 2026-04-19 | 28.4 (2026-03-18) | End of life |
| 27.x and older | | 2025-10-10 or earlier | | End of life |

GitHub release dates (from the [GitHub API](https://api.github.com/repos/bitcoin/bitcoin/releases?per_page=30)): 31.1 2026-07-08, 30.3 2026-07-10, 29.4 2026-07-10, 31.0 2026-04-20, 28.4 2026-04-06, 29.3 2026-02-11, 30.2 2026-01-13, 30.1 2026-01-02, 28.3 2025-10-30, 29.2 2025-10-14, 30.0 2025-10-13. The bitcoincore.org announcement dates differ by up to a few days; BTCortex should treat the bitcoincore.org `/bin/` directory and its signed `SHA256SUMS` as authoritative.

Tags `v32.0rc1` (2026-09-14) to `v32.0rc4` (2026-10-12) exist; the test builds are under `/bin/bitcoin-core-32.0/test.rcN/`. The [32.0 schedule](https://github.com/bitcoin/bitcoin/issues/35122) had feature freeze on 2026-08-20, branch-off and rc1 on 2026-09-14 and a target tag date of 2026-10-10.

### 1.2 Where release information lives

- Final notes: `doc/release-notes/release-notes-<version>.md` on `master` (for example [31.1](https://github.com/bitcoin/bitcoin/blob/master/doc/release-notes/release-notes-31.1.md)) and `https://bitcoincore.org/en/releases/<version>/`.
- Draft notes for the next major: the devwiki ([32.0 draft](https://github.com/bitcoin-core/bitcoin-devwiki/wiki/32.0-Release-Notes-Draft)); the release branch's `doc/release-notes.md` only points to it.
- Feeds: `https://bitcoincore.org/en/releasesrss.xml` (releases), `https://bitcoincore.org/en/rss.xml` (blog, including advisories), announcement mailing list `https://bitcoincore.org/en/list/announcements/join/`.
- GitHub releases (`https://api.github.com/repos/bitcoin/bitcoin/releases/latest`) carry the tag and a text that explicitly says: "Do not use the links provided by GitHub. Use the above download links instead" — there are no binary assets on GitHub.

Recommended update-discovery logic: poll the releases RSS feed and the GitHub API for new tags; then fetch `https://bitcoincore.org/bin/bitcoin-core-<version>/SHA256SUMS(.asc)`; never infer availability from a tag alone (30.0/30.1 show that published releases can be withdrawn and moved).

---

## 2. Windows distribution

### 2.1 Assets of 31.1 (directory listing of [/bin/bitcoin-core-31.1/](https://bitcoincore.org/bin/bitcoin-core-31.1/))

| File | Size (bytes) | SHA-256 (from SHA256SUMS) | Purpose |
|---|---|---|---|
| `bitcoin-31.1-win64-setup.exe` | 39 221 288 | `d0c6d0f3cd08689472a6f53c4ce33a5f059c092758c32c42541b47db4e193458` | NSIS installer, Authenticode-signed |
| `bitcoin-31.1-win64.zip` | 54 894 985 | `c99ef173471c58e6766d9eebd12e6c35349082eeed3939bc99eed58ef57db587` | Portable archive; every `.exe` inside is Authenticode-signed |
| `bitcoin-31.1-win64-setup-unsigned.exe` | 39 209 268 | `a8b6c8f7…d704` | Installer before code signing (for reproducibility checks) |
| `bitcoin-31.1-win64-unsigned.zip` | 54 818 341 | `a80ea8ec…d3ba` | Archive before code signing |
| `bitcoin-31.1-win64-debug.zip` | 578 896 264 | `74ba2188…4e98` | Debug symbols |
| `bitcoin-31.1-win64-codesigning.tar.gz` | 93 762 426 | `ea96df42…6d36` | Inputs for detached code signatures |
| `bitcoin-31.1-codesignatures-31.1.tar.gz` | 1 833 841 | | Detached Authenticode/macOS signatures |
| `SHA256SUMS`, `SHA256SUMS.asc`, `SHA256SUMS.ots` | 2956 / 8687 / 770 | | Checksums, OpenPGP signatures, OpenTimestamps proof |
| `bitcoin-31.1.torrent` | 29 046 | | Torrent of the release directory |

The Guix scripts confirm the naming: `build.sh` produces `${DISTNAME}-win64-setup-unsigned.exe` and `-win64-unsigned.zip`; `codesign.sh` attaches detached signatures with `osslsigncode attach-signature` to every `.exe` and creates the signed `-win64.zip` and `-win64-setup.exe` ([build.sh](https://github.com/bitcoin/bitcoin/blob/v31.1/contrib/guix/libexec/build.sh), [codesign.sh](https://github.com/bitcoin/bitcoin/blob/v31.1/contrib/guix/libexec/codesign.sh)). Earlier maintained releases follow exactly the same pattern (29.4, 30.3, 28.4 and 32.0rc4 checked).

**Authenticode signer** (parsed from the detached signature `win/bitcoin-31.1/bin/bitcoind.exe.pem` in [bitcoin-core/bitcoin-detached-sigs](https://github.com/bitcoin-core/bitcoin-detached-sigs/tree/v31.1/win)): `CN=Bitcoin Core Code Signing LLC, O=Bitcoin Core Code Signing LLC, L=Lewes, ST=Delaware, C=US`, issued by *DigiCert Trusted G4 Code Signing RSA4096 SHA384 2021 CA1*, timestamped by Sectigo. Use this only as defence in depth; the certificate may change between releases.

**Architectures**: the Guix host list is `x86_64-linux-gnu arm-linux-gnueabihf aarch64-linux-gnu riscv64-linux-gnu powerpc64-linux-gnu x86_64-w64-mingw32 …` — there is **no Windows ARM64 build**. The request is tracked in [issue #31388](https://github.com/bitcoin/bitcoin/issues/31388) ("This can be re-opened when there is a toolchain to achieve this"). Running the x64 build under Windows 11 ARM64 emulation is undocumented and untested here.

**Minimum Windows version**: 31.0 notes and the 32.0 draft: "Windows 10 (version 1903)"; 29.x/30.x notes: "Windows 10+". The executables' manifest ([windows-app.manifest.in](https://github.com/bitcoin/bitcoin/blob/v31.1/cmake/windows-app.manifest.in)) sets `<activeCodePage>UTF-8</activeCodePage>` and `requestedExecutionLevel level="asInvoker"` — the binaries never request elevation — and does **not** declare `longPathAware`.

### 2.2 URL patterns

- Final release: `https://bitcoincore.org/bin/bitcoin-core-<V>/bitcoin-<V>-win64.zip` (and `-win64-setup.exe`, `SHA256SUMS`, `SHA256SUMS.asc`, `bitcoin-<V>.torrent`).
- Release candidate: `https://bitcoincore.org/bin/bitcoin-core-<V>/test.rc<N>/bitcoin-<V>rc<N>-win64.zip` (for example `…/bitcoin-core-32.0/test.rc4/bitcoin-32.0rc4-win64.zip`).
- Withdrawn releases are moved out of the normal path: `https://bitcoincore.org/bin/insecure-wallet-deletion/bitcoin-core-30.0/` and `…/bitcoin-core-30.1/`; older ones under `/bin/insecure/`, `/bin/insecure-CVE-2015-6031/`, `/bin/insecure-CVE-2018-17144/`. BTCortex must refuse to install anything from an `insecure*` directory.
- Torrent: the download page offers `bitcoin-<V>.torrent` and a magnet link with web seed `ws=http://bitcoincore.org/bin/` ([download page](https://bitcoincore.org/en/download/)).

### 2.3 What the ZIP contains

Executables (from the list of detached signatures for 31.1): `bitcoin-31.1/bin/bitcoin.exe`, `bitcoind.exe`, `bitcoin-qt.exe`, `bitcoin-cli.exe`, `bitcoin-tx.exe`, `bitcoin-util.exe`, `bitcoin-wallet.exe`, and `bitcoin-31.1/libexec/test_bitcoin.exe`. `build.sh` also copies `doc/README_windows.txt` as `readme.txt`, the generated example `bitcoin.conf` and `share/rpcauth/` into the archive. There is no `bitcoin-node.exe`/`bitcoin-gui.exe` (§9.9).

### 2.4 The NSIS installer ([share/setup.nsi.in](https://github.com/bitcoin/bitcoin/blob/v31.1/share/setup.nsi.in))

- `RequestExecutionLevel highest`, `CRCCheck force`, `InstallDir $PROGRAMFILES64\Bitcoin` (so `C:\Program Files\Bitcoin` by default).
- Layout: `bitcoin-qt.exe`, `bitcoin.exe`, `COPYING.txt`, `readme.txt`, `bitcoin.conf` (example), `share\rpcauth\*` in the root; `daemon\bitcoind.exe`, `daemon\bitcoin-cli.exe`, `daemon\bitcoin-tx.exe`, `daemon\bitcoin-wallet.exe`, `daemon\test_bitcoin.exe`. **`bitcoin-util.exe` is not installed** by the installer. The `bitcoin.exe` wrapper explicitly searches a `daemon` subfolder "in a windows install" ([src/bitcoin.cpp](https://github.com/bitcoin/bitcoin/blob/v31.1/src/bitcoin.cpp)).
- Registry: `HKCU\SOFTWARE\Bitcoin Core` value `Path` (install directory) and `Components\Main`; Start-menu folder name under `HKLM\SOFTWARE\Bitcoin Core` (`MUI_STARTMENUPAGE_REGISTRY_ROOT HKLM`); uninstall entry `HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Bitcoin Core` with `DisplayVersion`; URL protocol `HKCR\bitcoin` → `"…\bitcoin-qt.exe" "%1"`.
- Start-menu shortcuts: Bitcoin Core, Bitcoin Core (testnet) `-testnet`, Bitcoin Core (test signet) `-signet`, Bitcoin Core (testnet4) `-testnet4`.
- Since 30.0 the installer no longer adds a "(64-bit)" suffix and removes obsolete artefacts during upgrades (30.0 notes).
- The uninstaller removes the program files, shortcuts, registry keys, `$SMSTARTUP\Bitcoin.lnk` and only `debug.log`/`db.log` *inside the install directory* — it never touches the data directory.

**Silent switches** (generic NSIS behaviour, [NSIS manual §3.2](https://nsis.sourceforge.io/Docs/Chapter3.html)): `/S` runs the installer or uninstaller silently; `/D=<absolute path>` overrides the install directory and "must be the last parameter used in the command line and must not contain any quotes, even if the path contains spaces"; `/NCRC` is ineffective because the script uses `CRCCheck force`; for the uninstaller, `_?=<dir>` sets `$INSTDIR` and prevents it copying itself to a temporary folder (use with a wait). Example: `bitcoin-31.1-win64-setup.exe /S /D=C:\Program Files\Bitcoin` and `"C:\Program Files\Bitcoin\uninstall.exe" /S`. Because of `RequestExecutionLevel highest`, an administrator still gets a UAC prompt and a standard user runs without elevation (in which case writes to Program Files, `HKLM` and `HKCR` are expected to fail); this interaction was not tested.

**Recommendation for BTCortex: do not use the installer.** It needs elevation for its default location, registers a system-wide `bitcoin:` URI handler, shares `C:\Program Files\Bitcoin` and the URI handler with the Knots installer (§12.6), and cannot keep several versions side by side. Use the signed ZIP (§2.5).

### 2.5 Unattended (zero-touch) installation procedure

The product requirement is that users only launch BTCortex and approve one overall plan. For Bitcoin Core this is achievable without administrator rights:

1. Resolve the target version (latest stable of the newest maintained line; never an RC unless the profile is a test profile; never anything from `/bin/insecure*`).
2. Download `SHA256SUMS` and `SHA256SUMS.asc`, verify the signature threshold (§3), then download `bitcoin-<V>-win64.zip` with resumable HTTP range requests and verify its SHA-256 while streaming.
3. Extract into a staging directory, e.g. `%LOCALAPPDATA%\BTCortex\runtimes\bitcoin-core\<V>.partial\`, validating every entry name (no absolute paths, no `..`, no drive letters, no alternate data streams, expected top-level folder `bitcoin-<V>/`, expected file list from §2.3) and rejecting symlinks/reparse points.
4. Verify Authenticode on each extracted `.exe` (WinVerifyTrust) and record the signer; treat a mismatch as a warning that blocks automatic installation but not a manual override.
5. Atomically rename to `…\bitcoin-core\<V>\`. Keep previous versions for rollback (§10.7); never add anything to `PATH`, never register URI handlers or Start-menu entries.
6. Create a dedicated data directory (default suggestion `%LOCALAPPDATA%\BTCortex\nodes\<profile-id>\` — short path, user-only ACL inherited from `%LOCALAPPDATA%`) unless the user chose to adopt an existing one (§5.9). Write `bitcoin.conf` there (§6.8).
7. Start `bitcoind.exe` with explicit `-datadir=…` (and nothing secret on the command line), poll RPC until warm-up ends, and run health checks.

Upgrades follow the same path: stop the node gracefully (§10), point the profile at the new runtime directory, start, verify `getnetworkinfo.version`. Running executables are locked by Windows, so in-place replacement is impossible anyway; versioned directories avoid partial upgrades.

---

## 3. Download verification

### 3.1 Formats

- `SHA256SUMS`: 28 lines for 31.1, LF line endings, trailing newline, each line `^[0-9a-f]{64}  <filename>$` (two spaces) covering every artefact in the directory.
- `SHA256SUMS.asc`: **concatenated, separately armoured detached signatures**, one `-----BEGIN PGP SIGNATURE-----` block per builder (11 blocks for 31.1). All are version 4, signature type 0x00 (*binary document*) — the signature covers the exact bytes of `SHA256SUMS`. Hash algorithm SHA-256 (Core) or SHA-256/SHA-512 (Knots); public-key algorithms RSA and EdDSA (legacy Ed25519).
- Signatures are appended over time as more builders attest, so the `.asc` file can grow after release; `SHA256SUMS` does not change.
- [guix.sigs README](https://github.com/bitcoin-core/guix.sigs): per-builder attestations live in `/<version>/<signer>/noncodesigned.SHA256SUMS(.asc)` and `all.SHA256SUMS(.asc)` ("all … covers all the binaries uploaded to the website, and is what to check release binaries against"); keys in `/builder-keys/<signer>.gpg` (40 key files on 2026-10-21).

### 3.2 Who signs (parsed from the `.asc` files and mapped to `builder-keys` fingerprints)

| Release | Valid builder signatures | Signers |
|---|---|---|
| 31.1 | 11 | achow101, fanquake (subkey), hebasto, benthecarman, guggero, marcofleon, pinheadmz, Emzy (subkey), willcl-ark (subkey), Sjors, TheCharlatan/sedited (subkey) |
| 31.0 | 13 | m3dwards, Emzy, theStack, svanstaa, guggero, willcl-ark, 0xb10c, fanquake, pinheadmz, hebasto, achow101, Sjors, sipsorcery |
| 30.3 | 11 | hebasto, Sjors, fanquake, achow101, willcl-ark, benthecarman, Emzy, TheCharlatan/sedited, svanstaa, guggero, pinheadmz |
| 30.2 | 8 | 0xb10c, achow101, Emzy, fanquake, guggero, hebasto, pinheadmz, Sjors |
| 29.4 | 13 | svanstaa, Sjors, pinheadmz, theStack, sipsorcery, TheCharlatan/sedited, benthecarman, guggero, hebasto, achow101, Emzy, willcl-ark, fanquake |
| 29.0 | 16 | including kvaciral, CoinForensics, glozow, laanwj |

Cross-checks for two anchors from independent sources: `SECURITY.md` lists Michael Ford (fanquake) `E777 299F C265 DD04 7930 70EB 944D 35F9 AC3D B76A` and Ava Chow (achow101) `1528 1230 0785 C964 44D3 334D 1756 5732 E08E 5E41` ([SECURITY.md](https://github.com/bitcoin/bitcoin/blob/master/SECURITY.md)); the download page shows fanquake's fingerprint too; both match `builder-keys/fanquake.gpg` and `achow101.gpg`.

Observations that matter for implementation:

- Several builders sign with a **subkey** (fanquake `CFB16E21C950F67FA95E558F2EEB9F5CC09526C1`, Emzy, willcl-ark, TheCharlatan). The issuer fingerprint in the signature is the subkey's; trust and de-duplication must be by **primary-key fingerprint**.
- `TheCharlatan.gpg` and `sedited.gpg` contain the same signing subkey (one person) — counting files instead of primary keys would double-count.
- `kvaciral.gpg` is an ECDSA key on **secp256k1** (curve OID 1.3.132.0.10), which OpenPGP.js 6.3.2 rejects by default (`rejectCurves: [secp256k1]`), and four key files use RSA-2048 (accepted: `minRSABits` 2047). OpenPGP.js 6.3.2 also rejects DSA/ElGamal keys and SHA-1 *message* signatures by default; no current builder signature uses them.

### 3.3 How many signatures to require

Upstream sets no threshold; the download page says to check that the checksums file "is PGP signed by a sufficient amount of keys you trust". Recent releases carry 8–16 valid builder signatures; the lowest observed for a maintained release was 8 (30.2). Recommended BTCortex policy:

- **Bitcoin Core: require ≥ 3 distinct valid signers from a pinned set of primary fingerprints** (default; configurable upwards to 5). Report every valid, invalid and unknown signature in the verification report. If fewer than 3 are valid right after a release, wait and re-fetch the `.asc` instead of lowering the threshold.
- **Bitcoin Knots: require ≥ 3 distinct valid signers including Luke Dashjr's key `1A3E761F19D2CC7785C5502EA291A2C45D0C504A`** (recent Knots releases had 3–7 signers, always including that key; 29.3.knots20260507 had exactly 3). Configurable; never below 2.
- Never auto-add new trust anchors. Key refreshes from guix.sigs may update existing pinned keys (expiry, new subkeys); a new builder joins the pinned set only through a BTCortex release.

### 3.4 Exact procedure without GnuPG (OpenPGP.js)

OpenPGP.js 6.3.2 (npm `openpgp`, published 2026-09-24, LGPL-3.0-or-later — package evaluation belongs to the `technology-frontend` scope) checks the signing key's validity **at the signature creation time** (`getSigningKey(keyID, signaturePacket.created)`) and rejects keys newer than the signature ([src/message.js](https://github.com/openpgpjs/openpgpjs/blob/v6.3.2/src/message.js)), so keys that expired after signing still verify old releases.

1. **Pinned keyring.** Ship, inside BTCortex, the armoured builder keys from `bitcoin-core/guix.sigs/builder-keys` (and `bitcoinknots/guix.sigs` branch `knots`) at a recorded commit, plus a table of trusted primary fingerprints → display names. Load with `openpgp.readKeys({ armoredKeys })` (one file may contain several keys, e.g. `luke-jr.gpg` holds two primaries). Optionally refresh the key files over HTTPS from GitHub, accepting only keys whose primary fingerprint is already pinned.
2. **Fetch** `SHA256SUMS` and `SHA256SUMS.asc` over HTTPS with certificate validation; keep `SHA256SUMS` as raw bytes (do not decode, normalise line endings or strip BOMs — the signatures are binary-mode).
3. **Split** the `.asc` text into blocks with `/-----BEGIN PGP SIGNATURE-----[\s\S]*?-----END PGP SIGNATURE-----/g` and parse each with `openpgp.readSignature({ armoredSignature })`; a block that fails to parse counts as invalid.
4. **Verify each block**: `const message = await openpgp.createMessage({ binary: sumsBytes }); const result = await openpgp.verify({ message, signature, verificationKeys: keyring });` then `await result.signatures[i].verified` (throws on failure; README pattern).
5. **Attribute** each successful signature to a primary key: find the key for which `key.getKeys(sig.keyID).length > 0` and take `key.getFingerprint()`; ignore it unless the primary fingerprint is pinned; de-duplicate by primary fingerprint.
6. **Threshold**: fail closed unless the number of distinct pinned primaries meets §3.3.
7. **Parse** `SHA256SUMS` strictly (regex above; reject duplicate filenames) and look up exactly `bitcoin-<V>-win64.zip` (Core) or `bitcoin-<V>-win64-pgpverifiable.zip` (Knots). The version string in the filename must equal the version BTCortex intended to install (prevents version-substitution with a validly signed older file).
8. **Download and hash** the archive (streaming SHA-256; resumable). Compare in constant time; on mismatch delete the file and report.
9. **Defence in depth** (Core only): after extraction verify Authenticode on each `.exe` and expect `Bitcoin Core Code Signing LLC`.
10. **Record** a verification report (version, URLs, `SHA256SUMS` hash, valid/invalid/unknown signers with fingerprints and signature times, archive hash, Authenticode result, timestamp) in the installation state for audit.
11. Optional: verify `SHA256SUMS.ots` (OpenTimestamps) as informational evidence of publication time.

Reproducing builds (Guix) is out of scope for BTCortex; the per-builder `all.SHA256SUMS` attestations give the same assurance as the combined `.asc`.

---

## 4. Executables

| Executable | Purpose | Notes for BTCortex |
|---|---|---|
| `bitcoind.exe` | Headless node and wallet daemon; JSON-RPC/REST/ZMQ server | The process BTCortex should supervise |
| `bitcoin-qt.exe` | GUI node and wallet; RPC server off unless `-server=1` | Launch only as an external application; cannot share a data directory with a running `bitcoind` |
| `bitcoin-cli.exe` | RPC client (`-named`, `-rpcwait`, `-rpcwaittimeout`, `-rpcclienttimeout` default 900 s, `-rpcwallet`, `-getinfo`, `-netinfo`, `-addrinfo`, `-stdin`, `-stdinrpcpass`, `-stdinwalletpassphrase`, `-generate`, `-color`) | BTCortex should speak JSON-RPC directly; useful for diagnostics |
| `bitcoin.exe` (30.0+) | Wrapper: `bitcoin node` = `bitcoind`, `bitcoin gui` = `bitcoin-qt`, `bitcoin rpc` = `bitcoin-cli -named`, plus `wallet`, `tx`, `util`, `test`, `chainstate`, `bench`; `-m` selects multiprocess binaries | `-m` fails on Windows because the multiprocess binaries are not shipped |
| `bitcoin-wallet.exe` | Offline wallet tool: `info`, `create` (descriptor wallet), `dump`, `createfromdump` | Only on unloaded wallets; legacy-wallet options removed in 30.0 |
| `bitcoin-tx.exe` | Create/modify raw transactions from the command line | Developer toolkit |
| `bitcoin-util.exe` | `grind` (proof of work on a header); 32.0 adds `getchainparams` | Not installed by the NSIS installer |
| `test_bitcoin.exe` (`libexec\`) | Unit tests | Not needed at runtime |
| `bitcoin-node`, `bitcoin-gui` | IPC-enabled multiprocess variants | **Not built for Windows** (§9.9) |
| `bitcoin-chainstate`, `bench_bitcoin`, `libbitcoinkernel` | Experimental tools/library | Source builds only, not in releases ([doc/files.md](https://github.com/bitcoin/bitcoin/blob/v31.1/doc/files.md)) |

---

## 5. Data directory, files and locks on Windows

### 5.1 Default location

`GetDefaultDataDir()` ([src/common/args.cpp](https://github.com/bitcoin/bitcoin/blob/v31.1/src/common/args.cpp)):

```cpp
// Windows:  old: C:\Users\Username\AppData\Roaming\Bitcoin
//           new: C:\Users\Username\AppData\Local\Bitcoin
fs::path legacy_path = GetSpecialFolderPath(CSIDL_APPDATA) / "Bitcoin";
if (fs::exists(legacy_path)) return legacy_path;
return GetSpecialFolderPath(CSIDL_LOCAL_APPDATA) / "Bitcoin";
```

Introduced in 28.0 (#27064; 27.2 still used `%APPDATA%` only). Consequences: **the mere existence of `%APPDATA%\Bitcoin` (even empty) makes Core 28+ keep using it**; nothing is migrated automatically. Bitcoin Knots 29.4.2 has the identical function. BTCortex should always pass `-datadir` explicitly for nodes it manages and treat both locations as candidates when detecting existing installations.

### 5.2 Network subdirectories

All content except `bitcoin.conf` is chain-specific ([doc/files.md](https://github.com/bitcoin/bitcoin/blob/v31.1/doc/files.md)): mainnet uses the base directory; `-chain=test`/`-testnet` → `testnet3\`; `-testnet4` → `testnet4\`; `-signet` → `signet\`; `-regtest` → `regtest\`. **Custom signets (`-signetchallenge`) also use `signet\`** (checked in 31.1 and 32.0rc4 `chainparamsbase.cpp`), so two different signets must never share a base data directory.

### 5.3 Layout (31.1)

| Path | Content |
|---|---|
| `blocks\blkNNNNN.dat`, `revNNNNN.dat` | Block and undo data (128 MiB files); relocatable with `-blocksdir` |
| `blocks\xor.dat` | XOR key for block/undo files (28.0+, random for a fresh blocks directory; `-blocksxor=0` only for new directories). Older software cannot read a non-zero-key blocks directory |
| `blocks\index\` | Block index (LevelDB; not moved by `-blocksdir`) |
| `chainstate\` | UTXO set (LevelDB); `chainstate_snapshot\` during assumeutxo background validation |
| `indexes\txindex\`, `indexes\txospenderindex\`, `indexes\blockfilter\basic\`, `indexes\coinstatsindex\` | Optional indexes (`indexes\coinstats\` is the pre-30.0 coinstats index, left for downgrades) |
| `wallets\<name>\wallet.dat` (+ `-journal`) | SQLite descriptor wallets; the default unnamed wallet lives in `wallets\` (or the data directory if `wallets\` does not exist) |
| `anchors.dat`, `banlist.json`, `peers.dat`, `fee_estimates.dat` (32.0: `fees\block_policy_estimates.dat`), `mempool.dat`, `onion_v3_private_key`, `i2p_private_key` | Runtime state |
| `bitcoin.conf` | User configuration, base directory only, never written by the node |
| `settings.json` | Read-write dynamic settings (network directory) |
| `debug.log` | Log (network directory) |
| `.cookie` | RPC cookie (network directory) |
| `bitcoind.pid` | PID file (network directory) |
| `.lock` | Lock file in the network directory and in the blocks directory |

### 5.4 `bitcoin.conf` semantics ([doc/bitcoin-conf.md](https://github.com/bitcoin/bitcoin/blob/v31.1/doc/bitcoin-conf.md), [src/common/config.cpp](https://github.com/bitcoin/bitcoin/blob/v31.1/src/common/config.cpp))

- `option=value` per line, no leading `-`; `#` starts a comment (own line preferred). Using `#` inside `rpcpassword` is a **parse error**. Values are mandatory (`testnet=1`, `nofoo=1`).
- Precedence: command line > `settings.json` > `bitcoin.conf`. Network-specific entries (`[main]`, `[test]` for testnet3, `[testnet4]`, `[signet]`, `[regtest]` — not `[mainnet]`/`[testnet]` — or the `regtest.option=` prefix) beat global ones; "if multiple values for the same option are found with the same precedence, the first one is generally chosen".
- Options flagged `NETWORK_ONLY` apply to mainnet only unless placed in a network section: `addnode`, `bind`, `connect`, `port`, `rpcbind`, `rpcport`, `wallet`, `walletdir`.
- `conf=` inside a configuration file is an error ("use includeconf= if you want to include additional config files"). `includeconf=<file>` is relative to the data directory, allowed per network (`[test] includeconf=…`), **not recursive** (an `includeconf` inside an included file is ignored with a warning), and can be disabled with `-noincludeconf` on the command line.
- `datadir=` in the default `bitcoin.conf` redirects to another data directory; a `bitcoin.conf` found in that other directory is then ignored and, unless `allowignoredconf=1`, start-up **fails** with an explanatory error. BTCortex-managed nodes should therefore keep their single `bitcoin.conf` inside their own data directory.
- Unknown keys in `bitcoin.conf` produce a warning (`Ignoring unknown configuration value …`) and are otherwise ignored; unknown command-line options are fatal. This matters for Knots→Core migration: Knots-only policy options silently stop applying.
- `reindex=1` in the file is accepted with a warning (it would reindex on every start).
- Negation: `-nofoo`/`nofoo=1` resets an option; since 29.0 negating list options such as `-noseednode`, `-nobind`, `-norpcbind`, `-norpcallowip`, `-noonlynet` simply restores defaults. `-nodatadir` is disallowed.
- Changes take effect only after a restart.

### 5.5 `settings.json`

Written by the GUI and by RPCs (for example `createwallet`/`loadwallet` with `load_on_startup` add to the `wallet` list) through a temporary file and rename; contains a `_warning_` key telling users not to edit it while the node runs; disabled with `-nosettings`; path via `-settings`. Keys the 31.1 GUI persists: `dbcache`, `lang`, `listen`, `natpmp`, `onion`, `par`, `proxy`, `prune`, `server`, `signer`, `spendzeroconfchange` ([src/qt/optionsmodel.cpp](https://github.com/bitcoin/bitcoin/blob/v31.1/src/qt/optionsmodel.cpp)). Because it overrides `bitcoin.conf`, BTCortex must read it when computing effective settings and show conflicts (for example a GUI-set `prune` silently overriding a `bitcoin.conf` value). Knots additionally stores `consensusrules: "rdts"` after BIP110 consent and writes GUI changes to `bitcoin_rw.conf`.

### 5.6 `.cookie` and `-rpccookieperms`

Generated at RPC start when no `-rpcpassword` is set ([src/rpc/request.cpp](https://github.com/bitcoin/bitcoin/blob/v31.1/src/rpc/request.cpp), [src/httprpc.cpp](https://github.com/bitcoin/bitcoin/blob/v31.1/src/httprpc.cpp)): 32 random bytes, written as `__cookie__:<64 hex>` to `.cookie.tmp` then renamed to `.cookie` in the network data directory (`-rpccookiefile` overrides; `-norpccookiefile` disables), deleted on shutdown if this process created it. A stale `.cookie` after a crash is overwritten at the next start; BTCortex must re-read it after every node start. `-rpccookieperms=owner|group|all` sets POSIX-style permissions; on Windows the Microsoft CRT `_chmod` can only toggle the read-only attribute ([Microsoft Learn](https://learn.microsoft.com/en-us/cpp/c-runtime-library/reference/chmod-wchmod)), so the effective protection is the NTFS ACL inherited from the data directory (inference, not tested). Do not place a data directory where other local users can read it (e.g. `C:\ProgramData`, shared folders).

### 5.7 `debug.log`

- Location: network data directory (`-debuglogfile`; `-nodebuglogfile` disables). `getrpcinfo` returns `logpath`.
- `-shrinkdebugfile` (default 1 unless `-debug` is set): at start-up, if the file exceeds 11 MB it is truncated to its last 10 MB. There is no rotation while running on Windows (the reopen-on-SIGHUP mechanism is POSIX only).
- Since 30.0 (29.1 backport) unconditional logging is rate-limited per source location (1 MiB per hour); suppressed output is marked with `[*]`.
- The file is opened with the C runtime in append mode; concurrent shared reading for a log viewer is expected to work, renaming or deleting it while the node runs is not.
- Timestamps are ISO 8601 UTC. The first lines of each start contain e.g. `Bitcoin Core version v31.1.0 (release build)` (Knots: `Bitcoin Knots version v29.4.2.knots20260508 …`), `Default data directory …`, `Using data directory …`, `Config file: …` and the effective non-secret arguments (`SENSITIVE` options `rpcpassword`, `rpcuser`, `rpcauth`, `torpassword` are masked).
- May contain IP addresses (`-logips`), wallet names and transaction IDs: treat as private data in diagnostic bundles.

### 5.8 `.lock`, `bitcoind.pid`

- `.lock` is created (empty) in the **network data directory and in the blocks directory** and locked with `LockFileEx(LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY)` ([src/util/fs.cpp](https://github.com/bitcoin/bitcoin/blob/v31.1/src/util/fs.cpp), [src/init.cpp](https://github.com/bitcoin/bitcoin/blob/v31.1/src/init.cpp)). The file is never deleted; the OS releases the lock when the process exits, even after a crash. A second instance fails with "Cannot obtain a lock on directory … Bitcoin Core is probably already running." BTCortex can probe whether a directory is in use by opening the existing `.lock` (never create it) and attempting the same non-blocking lock, releasing it immediately — a reliable "is a node running here" test independent of PID files. Never delete `.lock`.
- `bitcoind.pid` (network directory; `-pid`) contains the process ID, is created at start and deleted on shutdown; a stale file after a crash is harmless.

### 5.9 Safe detection of existing installations (zero-touch requirement)

Detection must be **read-only**: no file creation (not even `.lock`), no configuration writes, no starting of a found node without consent.

1. **Candidate data directories**: `%APPDATA%\Bitcoin`; `%LOCALAPPDATA%\Bitcoin`; `HKCU\Software\Bitcoin\Bitcoin-Qt` value `strDataDir` (the GUI stores a custom data directory there under the default application name `Bitcoin-Qt`, shared by Core and Knots GUIs — [src/qt/intro.cpp](https://github.com/bitcoin/bitcoin/blob/v31.1/src/qt/intro.cpp), [src/qt/guiconstants.h](https://github.com/bitcoin/bitcoin/blob/v31.1/src/qt/guiconstants.h)); any `datadir=` line inside a `bitcoin.conf` found in those directories; `-datadir=` arguments of running `bitcoind.exe`/`bitcoin-qt.exe` processes and of `Bitcoin*.lnk` start-up shortcuts (`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Bitcoin.lnk`, `Bitcoin (testnet).lnk`, `Bitcoin (<chain>).lnk` created by the GUI's "start on login" option).
2. **Installed binaries**: `HKCU\SOFTWARE\Bitcoin Core\Path`, `HKCU\SOFTWARE\Bitcoin Knots\Path`, the uninstall keys (`DisplayVersion`), `C:\Program Files\Bitcoin\bitcoin-qt.exe` and `daemon\bitcoind.exe` (read the version resource and Authenticode signature; the same folder may contain Knots — product name `Bitcoin Knots`).
3. **Per data directory**, determine: networks present (`blocks\`/`chainstate\` in the base and in `testnet3\`, `testnet4\`, `signet\`, `regtest\`); whether a node is running (`.lock` probe, `.cookie`, `bitcoind.pid` with a live PID); the implementation and version that last used it (last start-up banner in `debug.log`); Knots fingerprints (`bitcoin_rw.conf`, `consensusrules` in `settings.json`); data-format markers (`blocks\xor.dat` → used by ≥ 28.0; `indexes\coinstatsindex\` → ≥ 30.0); pruning (`prune` in `bitcoin.conf`/`settings.json`); wallets (`wallets\*\wallet.dat`; a file starting with `SQLite format 3` is a descriptor wallet, otherwise a legacy BDB wallet that Core 30+ can only migrate); size of `blocks\` and `chainstate\`.
4. **Present the findings in the plan**: "adopt existing node at … (Bitcoin Core 31.1, mainnet, pruned)" or "create a new node at …". Adopting must not silently change its `bitcoin.conf`: show a diff of proposed changes, back up the original (`bitcoin.conf.btcortex-<timestamp>.bak`), preserve comments and unknown keys, and prefer adding a BTCortex-managed `includeconf` only with consent (remember that values in the main file win over included ones).
5. **Never** reuse a directory last used by Knots 29.4.1+ for Bitcoin Core or vice versa (different chains, §12.7); never delete or move wallets; never "repair" a found directory automatically.

---

## 6. Configuration

All options below are from the generated example configuration for 31.1 ([share/examples/bitcoin.conf](https://github.com/bitcoin/bitcoin/blob/v31.1/share/examples/bitcoin.conf)) and the `AddArg` registrations in `src/init.cpp`, `src/init/common.cpp`, `src/chainparamsbase.cpp` and `src/wallet/init.cpp` (185 options; 41 are debug-only, shown only with `-help-debug`). **Every change to `bitcoin.conf` or `settings.json` needs a node restart.** Runtime alternatives exist for a few behaviours (column "Runtime").

Units: fee rates are in BTC/kvB (0.00001 BTC/kvB = 1 sat/vB).

### 6.1 Core, storage, indexes and performance

| Option | Default (31.1) | Notes | Runtime |
|---|---|---|---|
| `datadir`, `blocksdir`, `conf`, `includeconf`, `settings` | see §5 | `conf` only on the command line | — |
| `prune` | 0 | 1 = manual (`pruneblockchain`), ≥ 550 = target MiB for block+undo files; incompatible with `txindex`, `txospenderindex` and `-reindex-chainstate`; reverting needs a full re-download | `pruneblockchain` (manual mode) |
| `txindex` | 0 | Needed by `getrawtransaction` for confirmed transactions without a block hash | — |
| `txospenderindex` (31.0+) | 0 | Used by `gettxspendingprevout` for confirmed spends | — |
| `blockfilterindex` | 0 (`basic`) | BIP158 filters; compatible with pruning | — |
| `coinstatsindex` | 0 | Speeds up `gettxoutsetinfo`; compatible with pruning | — |
| `dbcache` | 1024 MiB if ≥ 4096 MiB RAM (64-bit), else 450 MiB (31.0+); minimum 4 | Warning if > 75% of RAM ([src/node/caches.cpp](https://github.com/bitcoin/bitcoin/blob/v31.1/src/node/caches.cpp)) | — |
| `par` | 0 (auto, up to 15; < 0 leaves cores free) | Script-verification threads | — |
| `assumevalid` | per-network hard-coded block | 0 verifies all scripts | — |
| `persistmempool`, `persistmempoolv1` | 1, 0 | `persistmempoolv1` writes the pre-27.0 `mempool.dat` format for downgrades | `savemempool` |
| `reindex`, `reindex-chainstate` | 0 | Rebuild; see §10.6 | — |
| `loadblock` | — | Import from external `blk` files | — |
| `blocksonly` | 0 | Disables transaction relay; `maxmempool` becomes 5 MB | — |
| `blocksxor` | 1 | XOR key for new blocks directories | — |
| `blockreconstructionextratxn` | 100 | Compact-block reconstruction pool | — |
| `alertnotify`, `blocknotify`, `startupnotify`, `shutdownnotify` | — | **Execute shell commands** | — |
| `allowignoredconf` | 0 | Turns the "ignored bitcoin.conf" error into a warning | — |
| `pid`, `debuglogfile` | `bitcoind.pid`, `debug.log` | | — |
| `daemon`, `daemonwait` | hidden on Windows | `-daemon=1` fails: "-daemon is not supported on this operating system" | — |

### 6.2 Connections, privacy networks and bandwidth

| Option | Default | Notes |
|---|---|---|
| `listen` | 1 unless `-proxy`, `-connect` or `-maxconnections=0` | `listen=0` also sets `natpmp=0`, `discover=0`, `listenonion=0`, `i2pacceptincoming=0` |
| `bind`, `whitebind` | `0.0.0.0` and `127.0.0.1:8334=onion` | Since 28.0 any explicit `bind` replaces the implicit onion bind and a failing bind aborts start-up |
| `port` | 8333 / 18333 / 48333 / 38333 / 18444 | When set, the onion bind port becomes `port + 1` (29.0+) |
| `natpmp` | **1 (since 30.0)** | PCP/NAT-PMP mapping on the router; `upnp` removed (warning-only alias in 29.x, unknown in 30.0+) |
| `maxconnections` | 125 (**200 in 32.0**) | Outbound is fixed at 8 full-relay + 2 block-relay-only + feelers; `addnode` peers (max 8) and private-broadcast connections (max 64) are separate |
| `maxuploadtarget` | 0 (off) | Per 24 h; peers with `download` permission exempt |
| `maxreceivebuffer`, `maxsendbuffer` | 5000, 1000 (×1000 bytes) | Per connection |
| `timeout` | 5000 ms | Connect timeout (`peertimeout` debug, 60 s) |
| `bantime` | 86400 s | Default manual ban |
| `addnode`, `connect`, `seednode` | — | `connect` disables automatic connections and DNS seeding |
| `dns`, `dnsseed`, `forcednsseed`, `fixedseeds` | 1, 1, 0, 1 | |
| `discover`, `externalip` | 1 when listening without proxy/externalip | |
| `onlynet` | — | `ipv4`, `ipv6`, `onion`, `i2p`, `cjdns` (the alias `tor` was removed in 31.0) |
| `proxy` | — | Since 30.0 `-proxy=<addr>=<network>` for `ipv4`, `ipv6`, `tor`, `cjdns`; `unix:` socket paths allowed; DNS lookups use the generic or IPv4/IPv6 proxy only |
| `onion`, `listenonion`, `torcontrol`, `torpassword`, `proxyrandomize` | `-proxy`, 1, `127.0.0.1:9051`, empty, 1 | Automatic ephemeral onion service when Tor control is reachable; 32.0 enables Tor PoW defences for it |
| `i2psam`, `i2pacceptincoming` | —, 1 | SAM v3 bridge |
| `cjdnsreachable` | 0 | |
| `v2transport` | 1 | BIP324 |
| `peerbloomfilters`, `peerblockfilters` | 0, 0 | `peerblockfilters` requires `blockfilterindex` |
| `asmap` | off | Since 31.0 `-asmap`/`-asmap=1` uses embedded data; files need an explicit name |
| `whitelist` | — | Permissions `bloomfilter`, `noban`, `forcerelay`, `relay`, `mempool`, `download`, `addr`; `in`/`out` flags (28.0+) |
| `networkactive` | 1 | Runtime: `setnetworkactive` |
| `privatebroadcast` (31.0+) | 0 | `sendrawtransaction` broadcasts over short-lived Tor/I2P connections; **use ≥ 31.1** (§11) |

### 6.3 Relay, mempool and mining policy

| Option | Default | Notes |
|---|---|---|
| `maxmempool` | 300 MB (min 5) | Unused allowance shared with the coins cache |
| `mempoolexpiry` | 336 h | |
| `minrelaytxfee` | 0.000001 (0.1 sat/vB, since 30.0/29.1) | Change together with `incrementalrelayfee` |
| `incrementalrelayfee` (debug) | 0.000001 | |
| `dustrelayfee` (debug) | 0.00003 (3 sat/vB) | |
| `blockmintxfee` | 0.00000001 (0.001 sat/vB, since 30.0) | |
| `datacarrier` | 1 | Not deprecated in 31.1/32.0rc4 |
| `datacarriersize` | **100000 since 30.0** (previously 83); applies to the aggregate of all OP_RETURN outputs, several allowed | `datacarriersize=83` restores the old limit |
| `permitbaremultisig` | 1 | |
| `bytespersigop` | 20 | Since 29.1/30.0 standard transactions are limited to 2500 legacy sigops (BIP54 preparation) |
| `acceptnonstdtxn` (debug) | 0 on mainnet | |
| `limitclustercount`, `limitclustersize` (debug, 31.0+) | 64 transactions, 101 kvB | Cluster mempool |
| `limitancestorcount`, `limitdescendantcount` (debug) | 25, 25 | Deprecated in 31.0; only used by wallet coin selection; `limitancestorsize`/`limitdescendantsize` now ignored with a warning |
| `whitelistrelay`, `whitelistforcerelay` | 1, 0 | |
| `blockreservedweight` (29.0+) | 8000 (min 2000) | Mining RPC clients only |
| `blockmaxweight` (debug since 30.0) | 4 000 000 | 32.0 rejects values below `blockreservedweight` |
| `mempoolfullrbf` | — | Removed in 29.0 (full RBF always on) |

### 6.4 RPC and REST

| Option | Default | Notes |
|---|---|---|
| `server` | 1 (`bitcoind`), 0 (`bitcoin-qt`) | |
| `rpcbind` | `127.0.0.1` and `::1` | Ignored unless `rpcallowip` is also set |
| `rpcallowip` | localhost | Single IP, netmask or CIDR; 32.0 disconnects disallowed clients immediately |
| `rpcport` | 8332 / 18332 / 48332 / 38332 / 18443 | |
| `rpcauth` | — | `<user>:<salt>$<hash>`, repeatable |
| `rpcuser`, `rpcpassword` | — | Supported; logs "less secure" warning; setting `rpcpassword` disables cookie generation |
| `rpccookiefile`, `rpccookieperms` | data directory, owner | §5.6 |
| `rpcwhitelist`, `rpcwhitelistdefault` | —, 1 if any whitelist exists | **Adding any `rpcwhitelist` makes every other user (including the cookie user) allow-nothing unless `rpcwhitelistdefault=0`** |
| `rpcthreads` | 16 (since 29.0) | `rpcworkqueue` (debug) 64, `rpcservertimeout` (debug) 30 s; 32.0 adds `rpcmaxconnections` 16 |
| `rest` | 0 | Unauthenticated |
| `deprecatedrpc` (debug) | — | 31.1 recognises `startingheight` and `warnings` |

### 6.5 Wallet

`disablewallet` (0), `wallet` (repeatable, network-only), `walletdir` (`<datadir>\wallets` if it exists), `addresstype` (`bech32`), `changetype`, `avoidpartialspends` (0), `consolidatefeerate` (0.0001), `discardfee` (0.0001), `fallbackfee` (0 = disabled), `keypool` (1000), `maxapsfee` (0), `mintxfee` (0.00001), `maxtxfee` (0.10 BTC), `spendzeroconfchange` (1), `txconfirmtarget` (6), `walletbroadcast` (1), `walletrbf` (1; deprecated in 32.0), `walletnotify` (executes a command; `%w` not implemented on Windows), `signer` (external signer command). Removed: `paytxfee`/`settxfee` (31.0), legacy-wallet options of `bitcoin-wallet` (30.0).

### 6.6 ZMQ, logging, chain selection

- ZMQ: `zmqpubhashblock`, `zmqpubhashtx`, `zmqpubrawblock`, `zmqpubrawtx`, `zmqpubsequence` and matching `…hwm` (1000).
- Logging: `debug=<category>` (repeatable; 31.1 categories: addrman, bench, blockstorage, cmpctblock, coindb, estimatefee, http, i2p, ipc, kernel, leveldb, libevent, mempool, mempoolrej, net, privatebroadcast, proxy, prune, qt, rand, reindex, rpc, scan, selectcoins, tor, txpackages, txreconciliation, validation, walletdb, zmq; 32.0 removes `libevent` and adds `mining`), `debugexclude`, `loglevel` (debug), `logips`, `logtimestamps` (1), `logthreadnames`, `logsourcelocations`, `loglevelalways`, `printtoconsole` (1 without `-daemon`), `shrinkdebugfile`, `uacomment`. Runtime: the `logging` RPC changes categories without restart.
- Chain: `chain=main|test|testnet4|signet|regtest`, `testnet` (testnet3, deprecated), `testnet4`, `signet`, `signetchallenge`, `signetseednode`, `regtest` (debug-listed), `vbparams`/`testactivationheight` (regtest only).

### 6.7 Changes in the last three majors and in 32.0

| Release | Added | Changed default / behaviour | Deprecated | Removed |
|---|---|---|---|---|
| 29.0 | `blockreservedweight` | `rpcthreads` 4→16, `rpcworkqueue` 16→64; onion port = `port + 1`; `dbcache` 16 GiB cap dropped; list-option negation semantics; `-debug=0/none` | — | UPnP support (`-upnp` becomes an alias of `-natpmp` with a warning); `mempoolfullrbf` |
| 30.0 | `bitcoin` wrapper; `-proxy=…=<network>`; IPC `-ipcbind` (Unix only); log rate limiting | `natpmp`=1; `datacarriersize`=100000 with multiple OP_RETURN outputs; `minrelaytxfee`/`incrementalrelayfee` 0.1 sat/vB; `blockmintxfee` 0.001 sat/vB; `blockmaxweight` debug-only; 32-bit caps for `maxmempool`/`dbcache`; Qt 6 GUI with Windows dark mode | `paytxfee`, `settxfee`; `maxorphantx` (no effect) | `upnp`; legacy BDB wallets and RPCs `addmultisigaddress`, `dumpprivkey`, `dumpwallet`, `importaddress`, `importmulti`, `importprivkey`, `importpubkey`, `importwallet`, `newkeypool`, `sethdseed`, `upgradewallet`, `getunconfirmedbalance`; `include_watchonly` options (some remain as ignored "(DEPRECATED) No longer used" positional parameters, e.g. in `listsinceblock`) |
| 31.0 | `privatebroadcast`; `txospenderindex`; cluster limits (`limitclustercount`, `limitclustersize`); embedded asmap | `dbcache` 1024 MiB on ≥ 4 GiB RAM; fee-estimator minimum bucket 0.1 sat/vB (old `fee_estimates.dat` discarded); Qt 6.8 | `limitancestorcount`, `limitdescendantcount`; `getpeerinfo.startingheight` | `paytxfee`, `settxfee`, `maxorphantx`; network name `tor` |
| 32.0 (draft, unreleased) | `inboundrelaypercent` (50), `rpcmaxconnections` (16), `prevoutfetchthreads` (8), `txsendrate`, log category `mining`; RPCs `getopenrpcinfo`, `rpc.discover`, `exportasmap`, `addhdkey`, `exportwatchonlywallet`, `derivehdkey` | `maxconnections` 125→200; PSBT version 2 by default; libevent replaced by a custom HTTP server; disallowed RPC clients disconnected; mempool-based fee estimator combined into `estimatesmartfee`; `fee_estimates.dat` moved to `fees\` | `walletrbf`; `removeprunedfunds`; `bip125-replaceable` and `fullrbf` fields | `deprecatedrpc=startingheight`; `libevent` log category; `taproot` in `getdeploymentinfo` |

Testnet3 has been deprecated (help text and start-up log warning) since 28.0 and is still available in 31.1 and 32.0rc4.

### 6.8 Parameter interactions, incompatibilities and dangerous options

Parameter interactions (`InitParameterInteraction` in [src/init.cpp](https://github.com/bitcoin/bitcoin/blob/v31.1/src/init.cpp)), all "soft" (only if the user did not set the target option): `bind`/`whitebind` → `listen=1`; `connect` or `maxconnections=0` → `dnsseed=0`, `listen=0`; `proxy` → `listen=0`, `natpmp=0`, `discover=0`; `listen=0` → `natpmp=0`, `discover=0`, `listenonion=0`, `i2pacceptincoming=0`; `externalip` → `discover=0`; `blocksonly=1` → `whitelistrelay=0`, `maxmempool=5`; `whitelistforcerelay=1` → `whitelistrelay=1`; `onlynet` without IPv4/IPv6 → `dnsseed=0`. The effective-settings view should reproduce these rules.

Fatal combinations: `prune` with `txindex`, `txospenderindex` or `reindex-chainstate`; `peerblockfilters` without `blockfilterindex`; `blockreservedweight` < 2000 or > 4 000 000; explicit `dnsseed=1` with an `onlynet` that excludes clearnet; `daemon` on Windows; negative `maxconnections`.

Options that execute commands or widen exposure and therefore need explicit confirmation in the editor: `alertnotify`, `blocknotify`, `walletnotify`, `startupnotify`, `shutdownnotify`, `signer`; `rpcbind`/`rpcallowip` beyond loopback; `rest=1`; any `zmqpub*` on a non-loopback address; `listen=1` with `natpmp=1`; `externalip`; `whitelist`/`whitebind` with `noban`, `forcerelay` or `mempool`; `peerbloomfilters`; `rpcwhitelistdefault=0`.

### 6.9 Hardware-aware automatic defaults (zero-touch requirement)

These are **BTCortex policy recommendations** derived from the upstream defaults above, not upstream rules. Inputs: total and available physical memory (`GlobalMemoryStatusEx`), free space on the target volume (`GetDiskFreeSpaceEx`), logical CPU count, whether the volume is an SSD, and whether the connection is metered.

- **Pruning decision.** Full mainnet needs roughly 856 GB of blocks plus 14 GB chainstate by the 31.1 estimate (the download page still says about 600 GB): any volume with less than ~1 TB free must be pruned. Prune target formula: `available = free − chainstate_estimate (14 GB) − safety_reserve (max(10 GB, 10% of volume)) − misc (2 GB)`; `prune_MiB = clamp(0.5 × available, 2 GB [GUI default], 50 GB)`, never below 550 MiB. The upstream minimum keeps at least the last 288 blocks.
- **dbcache.** Use the upstream default (1024 MiB on ≥ 4 GiB RAM) unless available memory is low: `dbcache = clamp(min(0.25 × total_RAM, available_RAM − 1.5 GB − maxmempool), 450, 4096)` during initial block download; 450–1024 MiB is sufficient afterwards. Never exceed the upstream 75 % warning threshold.
- **maxmempool.** Keep 300 MB (fee estimation and package relay quality) unless total RAM is below 4 GB (then 150 MB).
- **maxconnections.** Set explicitly so that the 32.0 default change (125 → 200) does not alter resource use silently; 40 is ample for a desktop. With `listen=0` only ~11 outbound connections exist anyway.
- **listen/natpmp.** For zero-touch, `listen=0` (which also disables NAT-PMP/PCP, address discovery and the automatic onion service) avoids an unexpected router port mapping and the Windows Defender Firewall prompt; offer inbound connectivity later as an explicit, privacy-labelled choice (spec 21.1 and 21.3). A pruned node serves only recent blocks, so the network loses little.
- **blocksonly.** Do not enable for a node that wallets use: it disables transaction relay, so `estimatesmartfee` has no mempool data and the node's own broadcasts become easy to attribute ([doc/reduce-memory.md](https://github.com/bitcoin/bitcoin/blob/v31.1/doc/reduce-memory.md): "any transaction sent will stick out like a sore thumb").
- **Indexes.** `txindex=0` (impossible with pruning), `blockfilterindex=0` by default on small disks (enable when space allows; it speeds up `scanblocks`-based rescans), `coinstatsindex=0`.

**Test machine (5.9 GB RAM, ~76 GB free) — computed profile:** `available = 76 − 14 − 10 − 2 = 50 GB` → 0.5 × 50 GB ≈ 25 GB → `prune=24000` (MiB, ≈ 25 GB; a few months of recent blocks at current block sizes — an estimate), resulting node footprint ≈ 25 GB + 14 GB + < 1 GB block index ≈ 40 GB, leaving ≈ 36 GB free. `dbcache=1024` (equals the upstream default for this RAM; total RAM 5.9 GB × 0.25 ≈ 1.5 GB), `maxmempool=300`, `maxconnections=40`, `listen=0`, `natpmp=0`. Example managed file:

```ini
# Managed by BTCortex — profile "mainnet (pruned)". Comments and unknown lines are preserved.
server=1
prune=24000
dbcache=1024
maxmempool=300
maxconnections=40
listen=0
natpmp=0
# printtoconsole=0 is passed on the command line by BTCortex; RPC stays on 127.0.0.1/::1 with cookie authentication.
```

**What pruning rules out** (must be explained before the plan is approved): `txindex` and `txospenderindex` (start-up error); Electrum servers (`fulcrum`, `electrs`, `electrumx` generally require an unpruned node — confirmation belongs to the `electrum-indexers-explorers` scope) and explorers that depend on them; `getblock`/`getblockstats` for pruned heights ("Block not available (pruned data)"; `getblockfrompeer` can re-fetch previously validated blocks); wallet rescans before the prune height ("Can't rescan beyond pruned data. Use RPC call getblockchaininfo to determine your pruned height."), hence restoring an old wallet seed cannot find its history; serving historical blocks (the node advertises `NODE_NETWORK_LIMITED`, BIP159); and switching back to an unpruned node, which needs `-reindex` and a full re-download. Wallets must stay loaded: if a wallet's last synchronisation falls behind the prune height while it is unloaded, Core refuses it with "Prune: last wallet synchronisation goes beyond pruned data. You need to -reindex (download the whole blockchain again in case of a pruned node)". `blockfilterindex` and `coinstatsindex` remain compatible (they hold prune locks until indexed); assumeutxo works with pruning but uses at least 1100 MiB.

---

## 7. RPC

### 7.1 Transport, endpoints, versions ([doc/JSON-RPC-interface.md](https://github.com/bitcoin/bitcoin/blob/v31.1/doc/JSON-RPC-interface.md), [src/httprpc.cpp](https://github.com/bitcoin/bitcoin/blob/v31.1/src/httprpc.cpp))

- HTTP `POST` only (other methods: 405), `Content-Type: application/json`. Endpoints `/` (all non-wallet calls; wallet calls only when exactly one wallet is loaded) and `/wallet/<urlencoded name>/` (required with several wallets; recommended always).
- Parameters by position or by name; every method also accepts a named `args` array for leading positional values.
- **JSON-RPC 1.1 vs 2.0** (28.0+): a request with `"jsonrpc": "2.0"` gets a strict 2.0 response (only one of `result`/`error`, HTTP 200 even for RPC errors, notifications without `id` executed and answered with HTTP 204). Without the marker, legacy 1.1 behaviour applies: both `result` and `error` present and HTTP 400 for `-32600`, 404 for `-32601`, 500 for other errors. BTCortex should always send 2.0 requests.
- **Batches**: a JSON array is executed sequentially in one HTTP request; per-item errors are embedded and the HTTP status is always 200; an all-notification batch returns 204; an empty batch returns `[]` (deliberate deviation from the 2.0 spec). If the user has an `rpcwhitelist`, every method in the batch is checked first and one disallowed method makes the whole batch fail with HTTP 403.
- **Authentication**: HTTP Basic against the cookie user (`__cookie__`), any `rpcauth` entries and the optional `rpcuser`/`rpcpassword` pair (stored internally as salted HMAC). Failed attempts are logged and delayed by 250 ms; missing header → 401 with `WWW-Authenticate: Basic realm="jsonrpc"`. `rpcauth` lines are generated as `<user>:<16-byte hex salt>$<hex HMAC-SHA256(key = salt string, message = password)>` ([share/rpcauth/rpcauth.py](https://github.com/bitcoin/bitcoin/blob/v31.1/share/rpcauth/rpcauth.py)) — BTCortex can generate them natively and store the password with DPAPI.
- **Warm-up**: during start-up most calls fail with `-28` (`RPC_IN_WARMUP`) and a progress message ("Loading block index…", "Verifying blocks…"); poll until it clears.
- **Discovery**: `help` lists methods grouped by category (`== Blockchain ==` …) and `help <method>` returns the signature and description; hidden methods are omitted. From 32.0, `getopenrpcinfo` (with `show_hidden=true`) and `rpc.discover` return an OpenRPC 1.4.1 document — use it when available and fall back to `help` parsing.
- **Versioning**: `getnetworkinfo.version` (e.g. 310100) and `subversion` (`/Satoshi:31.1.0/`; Knots `/Satoshi:29.4.2/Knots:20260508/`). The RPC interface is versioned implicitly by the major version; deprecated fields usually return for one major with `-deprecatedrpc=<name>`.
- 32.0 replaces libevent with a custom HTTP server: stricter header handling (8192-byte header limit, no line folding, conflicting `Content-Length` rejected).

### 7.2 Error codes ([src/rpc/protocol.h](https://github.com/bitcoin/bitcoin/blob/v31.1/src/rpc/protocol.h))

Standard: `-32700` parse error, `-32600` invalid request, `-32601` method not found, `-32602` invalid params, `-32603` internal error. General: `-1` misc, `-3` type, `-5` invalid address or key, `-7` out of memory, `-8` invalid parameter, `-20` database, `-22` deserialisation, `-25` verify error, `-26` verify rejected, `-27` already in UTXO set, `-28` in warm-up, `-32` method deprecated. P2P: `-9` not connected, `-10` in initial download, `-23` node already added, `-24` node not added, `-29` node not connected, `-30` invalid IP/subnet, `-31` P2P disabled, `-33` mempool disabled, `-34` node capacity reached. Wallet: `-4` wallet error, `-6` insufficient funds, `-11` invalid label, `-12` keypool ran out, `-13` unlock needed, `-14` wrong passphrase, `-15` wrong encryption state, `-16` encryption failed, `-17` already unlocked, `-18` wallet not found, `-19` wallet not specified, `-35` already loaded, `-36` already exists. Reserved: `-2` (safe mode). HTTP statuses used: 200, 204, 400, 401, 403, 404, 405, 500, 503.

### 7.3 Method catalogue (31.1) with risk classes

151 public methods (blockchain 38, control 6, mining 7, network 14, rawtransactions 21, signer 1, util 8, wallet 55, zmq 1) plus 19 hidden ones, taken from the [31.0.0 RPC documentation](https://bitcoincore.org/en/doc/31.0.0/) and cross-checked against the registration tables in the 31.1 source. Classes: **R** read-only; **R\*** read-only but heavy or long-running (run with a timeout, allow cancellation); **S** changes node or wallet state, low risk; **D** dangerous — irreversible, broadcasts or moves funds, manipulates the chain, deletes data, writes files on the node host or shuts down (explicit confirmation, never available to read-only credentials); **K** parameters or results may contain secrets (redact from history and logs).

**blockchain** — `dumptxoutset` D (writes a file on the node host; `rollback` temporarily invalidates blocks and disables networking), `getbestblockhash` R, `getblock` R, `getblockchaininfo` R, `getblockcount` R, `getblockfilter` R, `getblockfrompeer` S (contacts a peer; privacy), `getblockhash` R, `getblockheader` R, `getblockstats` R\*, `getchainstates` R, `getchaintips` R, `getchaintxstats` R, `getdeploymentinfo` R, `getdescriptoractivity` R\*, `getdifficulty` R, `getmempoolancestors` R, `getmempoolcluster` R (31.0+), `getmempooldescendants` R, `getmempoolentry` R, `getmempoolinfo` R, `getrawmempool` R, `gettxout` R, `gettxoutproof` R, `gettxoutsetinfo` R\*, `gettxspendingprevout` R, `importmempool` D (reads a file on the node host into the mempool), `loadtxoutset` D (assumeutxo), `preciousblock` D, `pruneblockchain` D (irreversible deletion), `savemempool` S (writes `mempool.dat`), `scanblocks` R\*, `scantxoutset` R\*, `verifychain` R\*, `verifytxoutproof` R, `waitforblock` R\*, `waitforblockheight` R\*, `waitfornewblock` R\* (long polls hold an RPC thread).

**control** — `getmemoryinfo` R, `getrpcinfo` R (active commands, `logpath`), `help` R, `logging` S, `stop` D, `uptime` R.

**mining** — `getblocktemplate` R\*, `getmininginfo` R, `getnetworkhashps` R, `getprioritisedtransactions` R, `prioritisetransaction` S (persists in `mempool.dat`), `submitblock` D, `submitheader` S.

**network** — `addnode` S, `clearbanned` S, `disconnectnode` S, `getaddednodeinfo` R, `getaddrmaninfo` R, `getconnectioncount` R, `getnettotals` R, `getnetworkinfo` R, `getnodeaddresses` R, `getpeerinfo` R (contains peer IP addresses — privacy-sensitive display), `listbanned` R, `ping` S, `setban` S (D for large subnets — can isolate the node), `setnetworkactive` D.

**rawtransactions** — `abortprivatebroadcast` S, `analyzepsbt` R, `combinepsbt` R, `combinerawtransaction` R, `converttopsbt` R, `createpsbt` R, `createrawtransaction` R, `decodepsbt` R, `decoderawtransaction` R, `decodescript` R, `descriptorprocesspsbt` K (descriptors may contain private keys), `finalizepsbt` R, `fundrawtransaction` S (may lock coins), `getprivatebroadcastinfo` R, `getrawtransaction` R, `joinpsbts` R, `sendrawtransaction` D (broadcast), `signrawtransactionwithkey` K, `submitpackage` D (broadcast), `testmempoolaccept` R (no broadcast), `utxoupdatepsbt` R.

**signer** — `enumeratesigners` S (executes the `-signer` command).

**util** — `createmultisig` R, `deriveaddresses` R, `estimatesmartfee` R, `getdescriptorinfo` R, `getindexinfo` R, `signmessagewithprivkey` K, `validateaddress` R, `verifymessage` R.

**wallet** — `abandontransaction` D, `abortrescan` S, `backupwallet` S (writes a file on the node host), `bumpfee` D (broadcasts a replacement), `createwallet` S/K (passphrase), `createwalletdescriptor` S, `encryptwallet` D/K (irreversible; a new backup is required afterwards), `getaddressesbylabel` R, `getaddressinfo` R, `getbalance` R, `getbalances` R, `gethdkeys` R/K (`private=true` returns extended private keys), `getnewaddress` S, `getrawchangeaddress` S, `getreceivedbyaddress` R, `getreceivedbylabel` R, `gettransaction` R, `getwalletinfo` R, `importdescriptors` D/K (may import private keys; triggers rescans), `importprunedfunds` S, `keypoolrefill` S, `listaddressgroupings` R, `listdescriptors` R/K (`private=true` exports private keys), `listlabels` R, `listlockunspent` R, `listreceivedbyaddress` R, `listreceivedbylabel` R, `listsinceblock` R, `listtransactions` R, `listunspent` R, `listwalletdir` R, `listwallets` R, `loadwallet` S, `lockunspent` S, `migratewallet` D/K (see the 30.0/30.1 incident), `psbtbumpfee` S (creates a PSBT only), `removeprunedfunds` D (deprecated in 32.0), `rescanblockchain` R\*, `restorewallet` S (reads a file on the node host), `send` D, `sendall` D, `sendmany` D, `sendtoaddress` D, `setlabel` S, `setwalletflag` S, `signmessage` S, `signrawtransactionwithwallet` S (signs, does not broadcast), `simulaterawtransaction` R, `unloadwallet` S (pruning hazard, §6.9), `walletcreatefundedpsbt` S, `walletdisplayaddress` S (hardware signer), `walletlock` S, `walletpassphrase` K, `walletpassphrasechange` K, `walletprocesspsbt` S (signs, does not broadcast).

**zmq** — `getzmqnotifications` R.

**hidden** (not listed by `help`, still callable) — `addconnection`, `addpeeraddress`, `echo`, `echojson`, `echoipc`, `mockscheduler`, `sendmsgtopeer`, `setmocktime`, `syncwithvalidationinterfacequeue` (test-only; hide in production), `estimaterawfee` R, `getmempoolfeeratediagram` R (31.0+), `getorphantxs` R, `getrawaddrman` R (privacy), `generate` (stub that only returns an error), `generateblock`, `generatetoaddress`, `generatetodescriptor` (regtest/signet block generation; hidden since at least 29.0), `invalidateblock` D, `reconsiderblock` D.

The bitcoin-qt console itself filters `createwallet`, `createwalletdescriptor`, `migratewallet`, `signmessagewithprivkey`, `signrawtransactionwithkey`, `walletpassphrase`, `walletpassphrasechange` and `encryptwallet` from its history ([src/qt/rpcconsole.cpp](https://github.com/bitcoin/bitcoin/blob/v31.1/src/qt/rpcconsole.cpp)); BTCortex's redaction list should be a superset (add `importdescriptors`, `descriptorprocesspsbt`, private results of `listdescriptors`/`gethdkeys`, and the Knots key RPCs in §12.5).

**Read-only credentials**: create a dedicated `rpcauth` user with an `rpcwhitelist` of R methods (and set `rpcwhitelistdefault=0` so that the cookie user keeps full access). This implements spec 5.7 "read-only mode" and 21.2 "scoped permissions" inside the node rather than only in the UI.

### 7.4 REST ([doc/REST-interface.md](https://github.com/bitcoin/bitcoin/blob/v31.1/doc/REST-interface.md))

Enabled by `-rest=1`, served on the RPC port without authentication. Endpoints (formats `.bin`, `.hex`, `.json` unless noted): `GET /rest/tx/<txid>` (mempool only unless `txindex=1`), `/rest/block/<hash>`, `/rest/block/notxdetails/<hash>`, `/rest/blockpart/<hash>.<bin|hex>?offset=&size=` (31.0+), `/rest/headers/<hash>?count=` (legacy `/rest/headers/<count>/<hash>` deprecated since 24.0), `/rest/blockfilterheaders/<type>/<hash>?count=`, `/rest/blockfilter/<type>/<hash>`, `/rest/blockhashbyheight/<height>`, `/rest/spenttxouts/<hash>` (30.0+, needs undo data), `/rest/chaininfo.json`, `/rest/deploymentinfo[.json|/<hash>.json]`, `/rest/getutxos[/checkmempool]/<txid>-<n>/…` (BIP64 serialisation), `/rest/mempool/info.json`, `/rest/mempool/contents.json?verbose=&mempool_sequence=`. 32.0 adds `Cache-Control` headers. Upstream warns that a browser on the same machine can be abused by web pages to read REST data; keep it off unless a consumer needs it.

### 7.5 ZMQ ([doc/zmq.md](https://github.com/bitcoin/bitcoin/blob/v31.1/doc/zmq.md))

PUB sockets; topics `rawtx`, `hashtx`, `rawblock`, `hashblock`, `sequence`; three-frame messages (topic, body, 4-byte LE per-topic sequence number for loss detection). `hashtx`/`rawtx` fire on mempool acceptance and again for each block containing the transaction; `*block` topics fire on tip changes only (subscribers must walk reorganisations themselves; with assumeutxo, background-validated historical blocks are not published); `sequence` carries `C`/`D` (block connected/disconnected) and `A`/`R` (mempool add/remove with an 8-byte mempool sequence number). TCP keep-alive and IPv6 are enabled on the socket; `unix:` paths are accepted for `rawblock`/`rawtx` (28.0+, not meaningful on Windows). No authentication. Windows release builds include ZMQ (depends builds `zeromq` for all hosts).

---

## 8. Networks and ports

| Network | Selector | Data subdirectory | P2P | RPC | Onion bind | Status |
|---|---|---|---|---|---|---|
| Mainnet | default / `-chain=main` | base | 8333 | 8332 | 127.0.0.1:8334 | Production |
| Testnet3 | `-testnet` / `-chain=test`, section `[test]` | `testnet3` | 18333 | 18332 | 18334 | Deprecated since 28.0, still supported; 31.1 estimate 245 GB + 19 GB |
| Testnet4 | `-testnet4`, section `[testnet4]` | `testnet4` | 48333 | 48332 | 48334 | BIP94, 28.0+; 31 GB + 2 GB |
| Signet | `-signet`, section `[signet]` | `signet` | 38333 | 38332 | 38334 | BIP325; 24 GB + 4 GB |
| Custom signet | `-signet -signetchallenge=<hex> [-signetseednode=host:port]` | `signet` (shared!) | 38333 | 38332 | 38334 | Separate data directory per challenge required |
| Regtest | `-regtest`, section `[regtest]` | `regtest` | 18444 | 18443 | 18445 | Local testing; `generate*` RPCs |

Network magic bytes (first byte): mainnet `f9`, testnet3 `0b`, testnet4 `1c`, regtest `fa` ([src/kernel/chainparams.cpp](https://github.com/bitcoin/bitcoin/blob/v31.1/src/kernel/chainparams.cpp)). Address HRPs `bc`, `tb`, `bcrt`. `getblockchaininfo.chain` returns `main`, `test`, `testnet4`, `signet` or `regtest`; for signet it also returns `signet_challenge`, which BTCortex should use to distinguish custom signets. Assumeutxo snapshot heights in 31.1: mainnet 840 000, 880 000, 910 000, 935 000; testnet3 2 500 000, 4 840 000; testnet4 90 000, 120 000; signet 160 000, 290 000.

---

## 9. Current protocol and policy features

1. **BIP324 v2 transport** — introduced in 26.0, on by default since 27.0 (`-v2transport`); `getpeerinfo` shows `transport_protocol_type` (`v1`/`v2`/`detecting`) and `session_id`.
2. **assumeutxo** — `loadtxoutset <path>` loads a UTXO snapshot whose hash is hard-coded (heights in §8); the node syncs from the snapshot to the tip and validates history in the background (`getchainstates`; 32.0 adds `getblockchaininfo.backgroundvalidation`). There is "no canonical source for snapshots" ([doc/assumeutxo.md](https://github.com/bitcoin/bitcoin/blob/v31.1/doc/assumeutxo.md)); two chainstates exist temporarily; indexes still build from genesis; snapshot format changed in 28.0; `dumptxoutset` requires a `type` (`latest` or `rollback`) since 29.0.
3. **Package relay** — opportunistic one-parent-one-child (1p1c) relay since 28.0 (a low-fee parent is paired with its child), extended in 30.0 to children with other in-mempool parents and in 31.0 to non-TRUC parents below `minrelaytxfee`; `submitpackage` accepts child-with-parents packages (no longer requires all unconfirmed parents since 30.0). P2P package messages (BIP331) are not implemented.
4. **TRUC (v3) transactions** — standard since 28.0 (BIP431: one unconfirmed parent/child, 10 kvB, sibling eviction, zero-fee parents inside packages); wallet creation and spending since 30.0 (`version` parameter).
5. **Cluster mempool** — shipped in **31.0**: clusters limited to 64 transactions / 101 kvB, chunk-feerate ordering for block building, eviction and relay; RBF accepted only if the feerate diagram improves; CPFP carve-out removed; new RPCs `getmempoolcluster` and hidden `getmempoolfeeratediagram`; chunk data in `getmempoolentry`.
6. **Ephemeral anchors and dust** — Pay-to-Anchor spends standard since 28.0 (BIP433); "ephemeral dust" (one dust output in a zero-fee transaction that must be spent in the same package) since 29.0.
7. **Full RBF** — default since 28.0, option removed in 29.0; `bumpfee`/`psbtbumpfee` no longer require BIP125 signalling (30.0).
8. **OP_RETURN policy** — `datacarriersize` 100 000 and multiple OP_RETURN outputs since 30.0 (not deprecated; Knots differs, §12.5). The project's statement on relay policy is at [bitcoincore.org/en/2025/06/06/relay-statement](https://bitcoincore.org/en/2025/06/06/relay-statement/).
9. **Multiprocess/IPC and mining interface** — 30.0 added the experimental Cap'n Proto IPC mining interface (`bitcoin -m node -ipcbind=unix`, used by Stratum v2 template-provider software owned by the `stratum-v2-reference-implementation` scope); 30.1 made `-m` optional when IPC options are used; 31.0 changed the schema incompatibly (`mining.capnp`); 32.0 changes `submitSolution` again. **Not available on Windows**: `ENABLE_IPC` is a `cmake_dependent_option(… "NOT WIN32" OFF)` ([CMakeLists.txt](https://github.com/bitcoin/bitcoin/blob/v31.1/CMakeLists.txt)) and depends defaults `NO_IPC=1` for mingw32 ([depends/Makefile](https://github.com/bitcoin/bitcoin/blob/v31.1/depends/Makefile)). Use WSL2 or a Linux host for it.
10. **Compact block filters** — BIP157/158: index since 0.19, serving to peers since 0.21 (`-peerblockfilters`).
11. **Private broadcast** (31.0) — `-privatebroadcast` sends `sendrawtransaction` transactions over separate short-lived Tor/I2P connections without putting them in the mempool first; wallet RPCs are not affected; IP leak bug in 31.0 fixed in 31.1; 32.0 caps the queue at 10 000 entries and 1000 attempts per transaction.
12. **Embedded asmap** (31.0) — off by default; `-asmap=1` uses the embedded map; 32.0 reports `asmap_version`.
13. **Other 2026 developments** — 32.0 draft: OpenRPC discovery, new HTTP server, `maxconnections` 200 with `inboundrelaypercent`, global transaction-relay rate limiting (`-txsendrate`, default 14 tx/s), a mempool-based fee estimator combined into `estimatesmartfee` (with `fee_rate_estimator` option), PSBT v2 default, `exportwatchonlywallet`, `addhdkey`, `derivehdkey`, parallel prevout prefetching (`-prevoutfetchthreads`), planned removal of MSVC builds, possible removal of CJDNS, legacy I2P ElGamal sessions to be removed by v34, and BIP323-based handling of version bits 5–28. BIP54 (consensus cleanup) is *Complete* but not deployed; Core only applies its sigops limit as policy. Erlay (BIP330) remains a debug-only option. The BIP110/Knots fork is covered in §12.

---

## 10. Lifecycle on Windows

### 10.1 Starting

Spawn `bitcoind.exe` directly (not via `cmd.exe`), with arguments as separate array elements, `CREATE_NO_WINDOW` (or a hidden console), working directory set to the runtime directory, and `-datadir=<path>` without a trailing backslash (a trailing `\` before a closing quote breaks Windows argument parsing). Pass `-printtoconsole=0` and read `debug.log`, but still drain stdout and stderr continuously (early `InitError` messages go to stderr; an undrained pipe can block the process). Never pass `rpcpassword` or other secrets on the command line (visible to other processes). Then poll `getblockchaininfo` until `-28` disappears and track `verificationprogress`, `initialblockdownload`, `blocks`/`headers`.

### 10.2 Graceful shutdown

- **Preferred: RPC `stop`** — returns "Bitcoin Core stopping" (Knots: "Bitcoin Knots stopping"); BTCortex then waits for process exit (and the release of `.lock`) with a generous timeout. Shutdown flushes the chainstate cache, which can take minutes after a large `dbcache` during initial sync.
- **Console control events**: `bitcoind` registers a console handler that requests shutdown for any control event and then sleeps, so the main thread can finish ([src/init.cpp](https://github.com/bitcoin/bitcoin/blob/v31.1/src/init.cpp)). Microsoft documents the time limits ([HandlerRoutine](https://learn.microsoft.com/en-us/windows/console/handlerroutine)): Ctrl+C and Ctrl+Break have **no timeout**; closing the console window (`CTRL_CLOSE_EVENT`) gives **5 seconds** before the process is killed; `CTRL_LOGOFF_EVENT`/`CTRL_SHUTDOWN_EVENT` are delivered only to services — interactive console applications are simply terminated at logoff or shutdown; services get 20 s on shutdown by default. Consequences: never run a managed node in a console window the user can close; BTCortex (a GUI process) must handle `WM_QUERYENDSESSION`, call `ShutdownBlockReasonCreate`, issue `stop` to every managed node and wait. `bitcoin-qt` already does this itself (`WinShutdownMonitor` blocks session end until its shutdown completes — [src/qt/winshutdownmonitor.cpp](https://github.com/bitcoin/bitcoin/blob/v31.1/src/qt/winshutdownmonitor.cpp)).
- Sending Ctrl+C to a child without a shared console (`GenerateConsoleCtrlEvent`) is awkward on Windows; use it only as a fallback when RPC is unavailable (e.g. stuck in warm-up), via a helper attached to the child's console or a process group created with `CREATE_NEW_PROCESS_GROUP` (Ctrl+Break).
- `TerminateProcess` only as a last resort.

### 10.3 Forced termination

The chainstate is written to disk periodically (every 50–70 minutes, randomised) and when the cache is full; a hard kill loses the work since the last flush, which is re-validated on restart ("Replaying blocks", "Rolling forward"). Usually recovery is automatic; worst cases need `-reindex-chainstate` or `-reindex`. Also lost: `mempool.dat`, fee estimates and `peers.dat` updates since start; `.cookie` and `bitcoind.pid` remain stale (harmless). SQLite wallets use a journal and are designed to survive crashes, but backups should only be taken with `backupwallet` ([doc/files.md](https://github.com/bitcoin/bitcoin/blob/v31.1/doc/files.md)).

### 10.4 Windows service

No native service mode (no service control handler in `bitcoind`), and `-daemon` is rejected on Windows. Running under a generic service wrapper (Task Scheduler at log-on, NSSM/WinSW-style wrappers) is possible but unsupported upstream; wrappers usually stop processes with Ctrl+C/close events, and the default 20-second service shutdown allowance is too short for a large cache flush unless the wrapper uses `stop` via RPC and pre-shutdown notification. Recommendation: BTCortex supervises nodes in the user session; an optional "keep running after I log off" feature would need its own BTCortex service component (design decision for the `technology-platform` scope).

### 10.5 Lock files and double starts

A second `bitcoind` on the same data directory or blocks directory fails immediately ("Cannot obtain a lock on directory …"). BTCortex should probe `.lock` before starting and offer to adopt the running instance (RPC via its cookie) rather than fail.

### 10.6 Corruption and reindexing

Messages to recognise in `debug.log`/stderr ([src/node/chainstate.cpp](https://github.com/bitcoin/bitcoin/blob/v31.1/src/node/chainstate.cpp), [src/init.cpp](https://github.com/bitcoin/bitcoin/blob/v31.1/src/init.cpp)): "Corrupted block database detected", "Error opening block database", "Error loading block database", "Error opening coins database", "Unable to replay blocks. You will need to rebuild the database using -reindex-chainstate.", "You need to rebuild the database using -reindex to go back to unpruned mode. This will redownload the entire blockchain", "Witness data for blocks after height %d requires validation. Please restart with -reindex.", "Disk space is too low!". The GUI asks "Do you want to rebuild the databases now?"; `bitcoind` exits. `-reindex-chainstate` rebuilds the UTXO set from local block files (not possible with pruning); `-reindex` rebuilds the block index and chainstate and wipes active optional indexes; on a pruned node `-reindex` means a full re-download. Both are destructive long operations (spec 21.3: explicit confirmation, show expected duration and disk impact) and must be one-shot command-line flags, never left in `bitcoin.conf`.

### 10.7 Upgrades and rollbacks (data-format changes)

- Blocks XOR (28.0): software older than 28.0 cannot read a blocks directory created with a non-zero key.
- `mempool.dat` XOR format (27.0, motivated by anti-virus software interpreting/modifying the file); `-persistmempoolv1` for downgrades.
- coinstatsindex moved to `indexes\coinstatsindex\` (30.0); the old index is kept for downgrades.
- 32.0 compact `txindex` format: once rebuilt, older releases rebuild it in the old format; `fee_estimates.dat` moves to `fees\`.
- Wallets: Core 30+ cannot load legacy BDB wallets (migration with `migratewallet`, never on 30.0/30.1); newer descriptor features (e.g. `musig()` descriptors since 30.0) may not load in older versions.
- Upstream: "Upgrading directly from a version of Bitcoin Core that has reached its EOL is possible, but it might take some time if the data directory needs to be migrated." Downgrades are not promised. BTCortex rule: allow rollback only within the same major line automatically; across majors require a backup and an explicit warning listing the changes above.

---

## 11. Security advisories and version warnings

Disclosure policy ([security advisories](https://bitcoincore.org/en/security-advisories/)): severities Critical, High, Medium, Low. "Low severity vulnerabilities will be disclosed 2 weeks after the release of a major version containing the fix. Medium and High severity vulnerabilities will be disclosed 2 weeks after the last affected release goes End of Life (approximately a year after a major version containing the fix was first released)." A pre-announcement with the number and severity of fixed issues accompanies each major release; Critical bugs follow an ad-hoc procedure. Reports go to `security@bitcoincore.org` ([SECURITY.md](https://github.com/bitcoin/bitcoin/blob/master/SECURITY.md)).

Recent advisories and incidents that drive warnings:

| Issue | Severity | Affected | Fixed | Source |
|---|---|---|---|---|
| CVE-2024-52911 script-interpreter use-after-free (remote crash, possible RCE) | High | 0.14.0 – < 29.0 | 29.0 (disclosed 2026-05-05) | [advisory](https://bitcoincore.org/en/2026/05/05/disclose-cve-2024-52911/) |
| CVE-2025-46597 (32-bit crash), CVE-2025-46598 (CPU DoS), CVE-2025-54604 and CVE-2025-54605 (disk filling via logs) | Low | < 30.0 | 30.0 (log rate limiting also in 29.1) | [advisories list](https://bitcoincore.org/en/security-advisories/) |
| CVE-2024-52919 part 2 (addr spam crash) | Low | < 29.0 | 29.0 | same |
| CVE-2024-52922 (block propagation stalling) | Medium | < 25.1 | 25.1 | same |
| CVE-2024-35202 (blocktxn remote crash) | High | < 25.0 | 25.0 | same |
| inv-to-send DoS; CVE-2024-52921 (mutated blocks) | Medium | < 25.0 | 25.0 | same |
| CVE-2019-25220 (headers memory DoS) | High | < 24.0.1 | 24.0.1 | same |
| Wallet migration failure may delete wallet files | (incident) | 30.0, 30.1 | 30.2; binaries withdrawn | [notice](https://bitcoincore.org/en/2026/01/05/wallet-migration-bug/) |
| `-privatebroadcast` may reveal sender IP after v2→v1 fallback | (incident) | 31.0 with `-privatebroadcast` | 31.1 | [notice](https://bitcoincore.org/en/2026/06/06/privatebroadcast-ip-leak/) |
| Chainstate repeatedly rewriting itself (excess disk I/O) | (bug) | releases before 31.1 / 30.3 / 29.4 | 31.1, 30.3, 29.4 | release notes |

Pending: the 32.0 draft pre-announces disclosure of **three Medium/High vulnerabilities fixed in 30.0**, two weeks after 32.0 is released (when 29.x reaches end of life).

Version-warning matrix for BTCortex: < 25.0 critical (High remote crashes) and end of life; < 29.0 strong warning (CVE-2024-52911) and end of life; 29.x supported until 32.0, then end of life with pending disclosures; 30.0/30.1 withdrawn — warn against wallet migration and upgrade; 31.0 — warn if `-privatebroadcast` is set; current recommendation 31.1 (or 30.3/29.4 for conservative users); release candidates only on test profiles.

---

## 12. Bitcoin Knots

### 12.1 Project facts

- Lead maintainer: Luke Dashjr ("Only Luke Dashjr (lead maintainer of Bitcoin Knots) may send messages to the announce mailing list" — [bitcoinknots.org](https://bitcoinknots.org/)). Repository [bitcoinknots/bitcoin](https://github.com/bitcoinknots/bitcoin), MIT, default branch `29.x-knots`, not archived, last push 2026-09-21.
- Versioning: `<base>.knots<YYYYMMDD>` (tags `v…`, release candidates `…rcN`). The base historically matched the Bitcoin Core release it was built on (e.g. 28.1.knots20250305, 29.1.knots20250903); since 29.4 the base numbers 29.4.1 and 29.4.2 have no Core counterpart and three releases share the suffix 20260508.
- Cadence (GitHub publication dates): 27.1.knots20240801 (2024-08-04), 28.1.knots20250305 (2025-03-06), 29.1.knots20250903 (2025-09-04), 29.2.knots20251010 (2025-10-10), 29.2.knots20251110 (2025-11-10), 29.3.knots20260210 (2026-02-10), 29.3.knots20260507 (2026-05-08), 29.3.knots20260508 (2026-05-09), 29.4.knots20260508 (2026-08-07), 29.4.1.knots20260508 (2026-09-02), **29.4.2.knots20260508 (2026-09-21)**. Irregular; there is no 30.x- or 31.x-based Knots line.
- Distribution: [bitcoinknots.org/files/29.x/29.4.2.knots20260508/](https://bitcoinknots.org/files/29.x/29.4.2.knots20260508/) and the GitHub release (assets attached). Linux (x86_64, aarch64, armhf, ppc64, ppc64le, riscv64), macOS 13+ (x86_64, arm64), Windows x64, Ubuntu PPA, StartOS package. Docker Hub `bitcoinknots/bitcoin` is explicitly **unofficial** ("not endorsed or associated with the Bitcoin Knots project").
- Licence: MIT.

### 12.2 Windows binaries

`bitcoin-29.4.2.knots20260508-win64-setup-pgpverifiable.exe` (34 MB) and `…-win64-pgpverifiable.zip` (49 MB), plus `-win64-debug.zip` and `-win64-codesigning.tar.gz`. Knots' Guix `build.sh` names the pre-codesigning outputs `-pgpverifiable` where Core uses `-unsigned` ([build.sh](https://github.com/bitcoinknots/bitcoin/blob/v29.4.2.knots20260508/contrib/guix/libexec/build.sh)); only these are published, so **Knots Windows executables are not Authenticode-signed**. Windows 10 or later. The ZIP is the right vehicle for BTCortex for the same reasons as with Core.

### 12.3 Verification

SHA256SUMS + SHA256SUMS.asc in the same format as Core. Signers mapped to [bitcoinknots/guix.sigs builder-keys](https://github.com/bitcoinknots/guix.sigs/tree/knots/builder-keys) (20 key files): 29.4.2 — luke-jr (`1A3E761F19D2CC7785C5502EA291A2C45D0C504A`, EdDSA with SHA-512), chrisguida, bitcoinmechanic, innerhat-dev, mhr6091, kwsantiago, leo-haf (7); 29.4.1 — 6; 29.4 — 5; 29.3.knots20260508 — 7; 29.3.knots20260507 — 3; 29.2.knots20251110 — 7. The website asks users to obtain keys from at least two independent sources and to verify before upgrading. Policy in §3.3.

### 12.4 Consensus divergence (chain split and hard fork) — what operators need to know

Facts from primary sources, presented without taking sides:

- **29.3.knots20260508** (2026-05-09) added enforcement of BIP110 (Reduced Data Temporary Softfork) as a modified BIP9 deployment (bit 4, start 2025-12-01, 55 % threshold, `max_activation_height` 965 664, one-year duration) behind a consent prompt or `consensusrules=rdts`; the same release without BIP110 support was offered as 29.3.knots20260507 ([release notes](https://github.com/bitcoinknots/bitcoin/releases/tag/v29.3.knots20260508), [chainparams v29.4](https://github.com/bitcoinknots/bitcoin/blob/v29.4.knots20260508/src/kernel/chainparams.cpp)).
- Mandatory signalling began at **height 961 632 on 2026-08-08**; enforcing nodes rejected non-signalling blocks. Knots' own pages state that "most SHA256d mining power kept producing those blocks" ([bitcoin-blake2b.org](https://bitcoin-blake2b.org/), linked from bitcoinknots.org); Bitcoin Optech describes it as an "unsuccessful activation attempt" and BIP110 is now *Closed* ([Optech #418](https://bitcoinops.org/en/newsletters/2026/08/14/), [BIP110](https://github.com/bitcoin/bips/blob/master/bip-0110.mediawiki)).
- **29.4.1.knots20260508** (2026-09-02) is a backward-incompatible protocol change: a new **BLAKE2b proof-of-work** algorithm, BIP110 activation at the proof-of-work change (flag day), a temporary 800 kWU block-weight limit, fixes for several long-standing issues (e.g. CVE-2013-2292, CVE-2017-12842, CVE-2020-14199), an opt-in unified signature hash (SIGHASH_UNIFIED) for replay protection, and removal of the BIP110 consent requirement ([release notes](https://github.com/bitcoinknots/bitcoin/releases/tag/v29.4.1.knots20260508)). Chain parameters: `Blake2bHeight = 961640` on mainnet and 150 308 on testnet4, **same network magic (`f9beb4d9`) and port 8333** ([chainparams v29.4.2](https://github.com/bitcoinknots/bitcoin/blob/v29.4.2.knots20260508/src/kernel/chainparams.cpp)). The first BLAKE2b block is dated 2026-08-30 by the project's linked site.
- **29.4.2.knots20260508** (2026-09-21) adds a soft fork extending coinbase maturity to 45 days, removes `getdifficulty` in favour of `difficulty_blake2b`, and states that nodes "already pruned past September 21" may need a full re-sync.
- Framing: Knots' notes call the SHA256d chain "a new altcoin launched by former miners" and describe miners who did not follow as attackers; Bitcoin Core does not implement BIP110 or BLAKE2b and its chain is the one followed by Core nodes and, per both sources above, the majority of SHA256d hash rate. BTCortex should state the facts and let the user choose, without labelling either chain.

Operator consequences:

1. Knots ≥ 29.4.1 and Bitcoin Core follow **different blockchains** after height ~961 632/961 640. Coins created earlier exist on both; transactions signed with legacy signature hashes can be replayed across chains; Knots wallets sign with the new hash by default (`walletoldsigs=1` restores legacy signing and "gives up replay protection").
2. Any service connected to a Knots ≥ 29.4.1 node (wallet, Electrum server, Lightning node, explorer, payment processor) sees Knots' chain. Compatibility of those services with BLAKE2b headers is unverified (Knots added new header fields to `getblock`/`getblockheader`).
3. A Knots node and a Core node will peer with each other on the same port and magic but reject each other's new blocks; Knots limits outbound connections to stale-rule peers (`-maxstaleoutbound`, default 8).
4. Data directories are not interchangeable across the split. Optech's Q&A notes that a pruned Knots node that enforced BIP110 probably still holds the last common block, so installing Bitcoin Core in its place and running `reconsiderblock` on the first block the BIP110 node rejected may avoid a full re-sync ([Optech #424](https://bitcoinops.org/en/newsletters/2026/09/25/)); for a node that followed BLAKE2b blocks, BTCortex should assume a fresh sync (untested).

### 12.5 Differences from Core that matter to a manager

- **Base**: Bitcoin Core 29.x code plus Knots patches; Core 30.0/31.0 features are absent unless backported (no `bitcoin` wrapper, no cluster mempool, no private broadcast, no `txospenderindex`, Qt 5.15.19 GUI). Core 29.x security fixes arrive only via Knots releases.
- **Defaults** (29.4.2 example configuration): `datacarriersize` 83 (maximum 83), `datacarriercost` 1, `rejecttokens` 1 (on by default since 29.4.1), `rejectparasites` 1, `permitbaremultisig` 0, `permitbarepubkey` 0, `permitbaredatacarrier` 0, `acceptnonstddatacarrier` 0, `acceptunknownwitness` 1, `maxscriptsize` 1650, `maxtxlegacysigops` 2500, `minrelaytxfee` 0.00001 (1 sat/vB, ten times Core's), `blockmintxfee` 0.00001, `dustrelayfee` 0.00003, `subdustfeepenalty` 1, `mempoolreplacement` `fee,-optin` (full RBF), `mempoolfullrbf` kept, `mempooltruc` `accept` (TRUC limits not enforced by default), `permitephemeral` `anchor,-send,-dust`, `blockmaxsize` 300 000, `blockprioritysize` 100 000, `maxconnections` 125, `upnp` available (default 0), `natpmp` 1, `dbcache` RAM-aware between 100 MiB and 2 GiB, `corepolicy` 0 (1 = use Core policy defaults).
- **Extra options** (selection): `consensusrules`, `confrw` (`bitcoin_rw.conf`), `lowmem`, `pruneduringinit`, `maxstaleoutbound`, `torexecute`, `uaappend`, `rpcauthfile`, `statsenable`, `statsmaxmemorytarget`, `walletimplicitsegwit`, `walletoldsigs`, `signetblocktime`, `spkreuse`, `minrelaycoinblocks`, `minrelaymaturity`, `dustdynamic`, `bytespersigopstrict`, `zmqpubhashwallettx`, `zmqpubrawwallettx`; debug-only `softwareexpiry`, `v2onlyclearnet`. Core options Knots lacks: `privatebroadcast`, `txospenderindex`.
- **RPC** (registration tables of 29.4.2 vs Core 31.1): Knots adds `getgeneralinfo`, `getrpcwhitelist`, `listmempooltransactions`, `listprunelocks`, `setprunelock`, `maxmempool`, `savefeeestimates`, `scriptthreadsinfo`, `setscriptthreadsenabled`, `setfeerate`, `settxfee`, `sweepprivkeys` (K), `dumpmasterprivkey` (K) and keeps the legacy-wallet RPCs removed from Core 30.0 (`dumpprivkey` K, `dumpwallet` K, `importprivkey` K, `importwallet` K, `importaddress`, `importpubkey`, `importmulti`, `addmultisigaddress`, `newkeypool`, `sethdseed`, `upgradewallet`, `getunconfirmedbalance`), hidden `format`, `getblockfileinfo`, `getblocklocations`; it lacks `getmempoolcluster`, `getprivatebroadcastinfo`, `abortprivatebroadcast`, hidden `getmempoolfeeratediagram` and (29.4.2) `getdifficulty`.
- **REST**: adds `/rest/fee` and `/rest/mempool/transactions`; lacks `/rest/blockpart`.
- **Software expiry**: each build stops accepting new blocks ("node-expired") roughly two years after its copyright year — for 29.4.2 at Unix time 1857151480 (≈ 2028-11-06) — with a warning four weeks earlier; `softwareexpiry=0` overrides ([clientversion.h](https://github.com/bitcoinknots/bitcoin/blob/v29.4.2.knots20260508/src/clientversion.h)). BTCortex must surface the warning and schedule updates.
- **Identification**: `getnetworkinfo.subversion` `/Satoshi:29.4.2/Knots:20260508/`; `stop` returns "Bitcoin Knots stopping"; `debug.log` banner "Bitcoin Knots version …"; 29.4.2 `getblockchaininfo` includes `difficulty_blake2b`.

### 12.6 Windows coexistence with Bitcoin Core

Knots' installer ([setup.nsi.in](https://github.com/bitcoinknots/bitcoin/blob/v29.4.2.knots20260508/share/setup.nsi.in)) also installs to `$PROGRAMFILES64\Bitcoin` and registers `HKCR\bitcoin`; only the product registry key differs (`HKCU\SOFTWARE\Bitcoin Knots`). Installing one vendor installer over the other replaces the binaries in place. Both use the same default data directory and the same QSettings key (`HKCU\Software\Bitcoin\Bitcoin-Qt`, including `strDataDir`). BTCortex must therefore keep separate runtime directories and data directories, never rely on defaults, and warn when it detects both.

### 12.7 Data-directory compatibility

Same layout as Core 29.x plus `bitcoin_rw.conf`. Before the split a datadir could be shared (one at a time); now it cannot: Core cannot validate BLAKE2b blocks and Knots ≥ 29.4.1 rejects Core-chain blocks after the fork height. Additional caveats: Core 30+ cannot load legacy BDB wallets that Knots still uses; Core ≥ 30 coinstatsindex location; Knots ignores Core-only options in `bitcoin.conf` with a warning and vice versa (silent policy changes).

---

## 13. Sparrow with a pruned Bitcoin Core node (zero-touch requirement)

Sparrow is owned by the `wallets-hardware` scope (`sparrow`, latest 2.5.5 published 2026-09-17); these are the node-side requirements BTCortex must satisfy when pre-wiring it ([Sparrow: connect to a node](https://sparrowwallet.com/docs/connect-node.html), [BitcoindClient.java](https://github.com/sparrowwallet/sparrow/blob/master/src/main/java/com/sparrowwallet/sparrow/net/cormorant/bitcoind/BitcoindClient.java)):

- `server=1`; **the node wallet must be enabled** (no `disablewallet=1`): Sparrow's Cormorant layer creates and loads a Core wallet named `cormorant` with `createwallet cormorant disable_private_keys=true blank=true passphrase="" avoid_reuse=true descriptors=true load_on_startup=true` (so it is added to `settings.json`) and imports watch-only descriptors into it.
- Bitcoin Core 24 or later ("Bitcoin Core versions older than v24 are not supported").
- Local connections authenticate with the cookie: Sparrow reads `.cookie` from the configured Core data folder, so BTCortex must give Sparrow the managed data directory path (the cookie changes at every node start). Remote connections need user/password (rpcauth recommended).
- Pruned nodes are supported with limits: Sparrow reads `getblockchaininfo.pruned`/`pruneheight`, computes the prune date from that block's header and refuses imports whose wallet birthday is earlier ("Wallet birthday earlier than Bitcoin Core prune date"); rescans start at least two hours after the prune date. Sparrow's documentation: "you won't be able to scan for transactions earlier than whatever the earliest retained (unpruned) block is" and reverting requires a full re-sync.
- Consequences for zero-touch: a **new** wallet created after the node synced works; **restoring an old seed** on a pruned node cannot recover its history (offer an unpruned profile or an Electrum server on a machine with enough disk instead). `txindex=1` (which "enables certain features … normally only available with an Electrum server") is impossible when pruned; `blockfilterindex=1` speeds up rescans on Core 25+ if disk allows. Keep the `cormorant` wallet loaded at every start (never start a pre-wired node with `-nowallet`/`-disablewallet`), otherwise pruning can overtake it (§6.9). Connecting over Tor is documented as slow. Pre-wiring Sparrow to a Knots ≥ 29.4.1 node would put the wallet on Knots' chain — never do this silently.

---

## 14. Recommended BTCortex integration approach and support levels

### 14.1 Bitcoin Core — `fully-managed`, priority P0

Rationale: official signed x64 binaries, a portable ZIP that runs without elevation, a well-documented configuration and RPC surface, and verifiable releases make full lifecycle management on Windows feasible today. Feasible alternatives in order: `remote-managed` (SSH-tunnelled RPC to a Linux node), `connected-application` (adopt an existing local node without managing its lifecycle), `managed-wsl2` (needed for IPC/multiprocess and Stratum v2 template providers), `external-launcher` (bitcoin-qt), `managed-docker` (only community images such as the explicitly unofficial `bitcoin/bitcoin`, intended for testing).

Adapter design:

1. **Release service** — discovery (§1.2), verification (§3), extraction (§2.5), runtime registry with versioned directories, rollback rules (§10.7), refusal of withdrawn releases.
2. **Profile service** — one data directory per (implementation, chain, signet challenge) with stored chain identity (genesis hash, `signet_challenge`, implementation, last version); a lock that prevents two profiles from pointing at the same directory (spec 5.3).
3. **Config service** — a lossless `bitcoin.conf` parser/writer (keep comments, order, unknown keys, sections, `includeconf` graph), a typed option catalogue per version generated from `-help`/`-help-debug` text of the installed binary plus the tables in §6, effective-settings computation (command line > `settings.json` > `bitcoin.conf`, network sections, parameter interactions §6.8), validation of fatal combinations, deprecation flags (§6.7), and secret handling (no `rpcpassword` in files; cookie or rpcauth).
4. **Process supervisor** — spawn rules (§10.1), readiness via RPC, health checks, graceful stop (§10.2), `WM_QUERYENDSESSION` handling, crash detection and restart policy with back-off, `.lock` probing.
5. **RPC client** — JSON-RPC 2.0, batches, per-wallet endpoints, `-28` handling, timeouts per method class (§7.3), cancellation for long scans (`scantxoutset abort`, `abortrescan`), method catalogue from `help` or `getopenrpcinfo`, risk classes and redaction, optional read-only rpcauth user.
6. **Observability** — `getblockchaininfo`, `getnetworkinfo`, `getpeerinfo`, `getmempoolinfo`, `getindexinfo`, `getnettotals`, `getrpcinfo`, `uptime`, `getdeploymentinfo`; ZMQ `sequence` for live mempool/block events; `debug.log` tailing; disk monitoring with a graceful stop before Core's own "Disk space is too low!" shutdown.
7. **Capability detection** — version (`getnetworkinfo.version`), implementation (`subversion`), wallet and ZMQ availability (`getzmqnotifications`), indexes, prune state, and presence of version-specific methods.

### 14.2 Bitcoin Knots — `fully-managed` (technically), priority P1, gated

Lifecycle management is technically the same as for Core (ZIP, RPC, files), so `fully-managed` remains the recommended support level, but feasibility is **medium** and the integration must be gated:

- Model Knots ≥ 29.4.1 as its **own network family** ("Bitcoin Knots chain (BLAKE2b)") with distinct visual identity, never as an interchangeable "Bitcoin mainnet" backend; profiles record the consensus rules the node enforces.
- Require explicit, informed consent before installing or adopting a Knots node, with a neutral explanation of §12.4.
- Dependency resolver: block silent wiring of Core-chain services (Electrum servers, Lightning, Sparrow, BTCPay) to a Knots ≥ 29.4.1 profile; treat their compatibility as unverified until tested.
- Never include Knots in the zero-touch default plan.
- PGP-only verification with the Knots key set; expect SmartScreen/Defender reputation prompts if files ever carry Mark of the Web (unverified).

---

## 15. Windows-specific pitfalls

1. An existing (even empty) `%APPDATA%\Bitcoin` silently remains the default data directory for Core 28+ and Knots; always pass `-datadir`.
2. Core and Knots share the default data directory, install directory, `bitcoin:` URI handler and GUI registry key.
3. Console close gives 5 s; logoff/shutdown terminate console processes without notification — BTCortex must stop nodes itself on `WM_QUERYENDSESSION`.
4. No service mode; `-daemon` fails on Windows.
5. Undrained stdout/stderr pipes can block `bitcoind`; use `-printtoconsole=0` and still drain.
6. `debug.log` cannot be rotated while running; it is only trimmed at start-up.
7. The executables do not declare `longPathAware`: keep data-directory paths short (deep LevelDB paths such as `indexes\blockfilter\basic\db\…` count against `MAX_PATH`).
8. Windows 10 1903+ is required (UTF-8 active code page manifest); non-ASCII user-profile paths are expected to work on supported versions (not tested).
9. Anti-virus: Core XORs block files (28.0+) and `mempool.dat` (27.0+, explicitly to stop anti-virus software interpreting or modifying the data); do not disable `-blocksxor`. Never add Defender exclusions or disable protection automatically (spec 17.3); if offered, exclusions must be an explicit user choice. Controlled Folder Access can block writes in protected folders (Documents etc.) — Core then reports "Cannot write to directory".
10. A listening node is expected to trigger a Windows Defender Firewall prompt; zero-touch profiles use `listen=0` (§6.9).
11. `natpmp=1` (30.0+) changes the router configuration when listening; turn it off unless the user opts in.
12. `-rpccookieperms` is POSIX-oriented; on Windows rely on NTFS ACLs and keep data directories under the user profile.
13. Trailing backslashes in quoted path arguments break argument parsing; never pass secrets as arguments.
14. Running executables are locked: upgrades need a stop first; use versioned runtime directories.
15. The NSIS installer needs elevation for its default location and registers system-wide handlers; prefer the ZIP.
16. Knots executables are not Authenticode-signed.
17. No ARM64 build; x64 emulation on Windows 11 ARM64 untested.
18. exFAT is reported to corrupt databases on macOS ([doc/files.md](https://github.com/bitcoin/bitcoin/blob/v31.1/doc/files.md)); for Windows, prefer NTFS local volumes (exFAT/network shares untested — warn).
19. IPC/multiprocess (Stratum v2 template providers) is unavailable natively; use WSL2 or Linux.
20. bitcoin-qt "start on login" creates `Bitcoin.lnk` in the Startup folder; a BTCortex-managed `bitcoind` on the same directory would then conflict at log-on — detect and offer to remove it (with consent).

---

## 16. Security considerations for BTCortex

- Treat RPC credentials as root access to funds and node: cookie by default, DPAPI-protected rpcauth passwords for remote/scoped users, rpcwhitelist-based read-only role, no secrets in command lines, logs, crash reports or diagnostic bundles; redaction list per §7.3 and §12.5.
- Keep RPC/REST/ZMQ on loopback; remote access only through authenticated tunnels with host-key/certificate verification (spec 21.2); never open firewall ports automatically.
- Supply chain: pinned builder keys, signature threshold, strict `SHA256SUMS` parsing with version binding, refusal of `insecure*` releases, archive path validation, Authenticode check for Core, verification report stored for audit.
- Configuration import: never execute or accept `*notify`/`signer` commands from imported or adopted configurations without showing them; flag privacy-exposing changes (listen, natpmp, externalip, Tor/I2P changes, REST, non-loopback ZMQ).
- Wallet safety: never delete or move wallet files; use `backupwallet`; block `migratewallet` on 30.0/30.1; warn that encrypting a wallet requires a new backup; keep wallets loaded on pruned nodes.
- Destructive operations (`-reindex`, `pruneblockchain`, `invalidateblock`, `stop`, broadcasts, fund movement) need explicit confirmation with a preview (spec 21.3), even inside an approved zero-touch plan.
- Chain identity: verify the genesis hash, `chain`, `signet_challenge` and implementation on every connection; prevent cross-chain mistakes (mainnet vs test networks, Core chain vs Knots chain).

---

## 17. Open questions

1. Product decision: should BTCortex offer Bitcoin Knots ≥ 29.4.1 at all, and if so, how is a second "mainnet-like" chain presented in the catalogue, the dependency graph and the network indicator?
2. Default signature thresholds (3 for Core, 3 including the lead maintainer for Knots) — confirm with security review; should OpenPGP.js be configured to accept secp256k1 ECDSA keys (one Core builder key) or ignore them?
3. 32.0 final release notes (expected imminently) must be re-checked against §6.7, §7 and the standards file, especially `maxconnections`, PSBT v2 default and the HTTP-server change.
4. Behaviour of the NSIS installer with `/S` for standard users (HKCR/HKLM writes) and whether any supported scenario needs it at all.
5. Measured mainnet sizes (blocks, chainstate, blockfilterindex) on the test machine to replace the chain-parameter estimates in the prune formula.
6. Initial-sync duration on the 5.9 GB/76 GB test machine (SSD vs HDD) for the onboarding estimate; whether to offer assumeutxo with a third-party snapshot (requires a trusted distribution decision).
7. Whether a BTCortex Windows service component is wanted for "keep node running after log-off" and how it would stop nodes within Windows' shutdown limits.
8. Behaviour of the x64 build on Windows 11 ARM64 (Prism emulation).
9. How Core behaves when started on a data directory synchronised by Knots 29.4.1+ (expected: refuses or needs re-sync) — needed for safe repair guidance.
10. Whether Sparrow (owned by `wallets-hardware`) can be pre-configured programmatically without writing secrets in plain text (cookie path only).

---

## 18. Sources (all accessed 2026-10-21)

Bitcoin Core: [download page](https://bitcoincore.org/en/download/) · [lifecycle](https://bitcoincore.org/en/lifecycle/) · [security advisories](https://bitcoincore.org/en/security-advisories/) · [/bin/bitcoin-core-31.1/](https://bitcoincore.org/bin/bitcoin-core-31.1/) · [/bin/bitcoin-core-32.0/test.rc4/](https://bitcoincore.org/bin/bitcoin-core-32.0/test.rc4/) · [/bin/insecure-wallet-deletion/](https://bitcoincore.org/bin/insecure-wallet-deletion/) · [releases RSS](https://bitcoincore.org/en/releasesrss.xml) · [GitHub releases API](https://api.github.com/repos/bitcoin/bitcoin/releases?per_page=30) · release notes [28.0](https://github.com/bitcoin/bitcoin/blob/master/doc/release-notes/release-notes-28.0.md), [29.0](https://github.com/bitcoin/bitcoin/blob/master/doc/release-notes/release-notes-29.0.md), [30.0](https://github.com/bitcoin/bitcoin/blob/master/doc/release-notes/release-notes-30.0.md), [30.2](https://github.com/bitcoin/bitcoin/blob/master/doc/release-notes/release-notes-30.2.md), [30.3](https://github.com/bitcoin/bitcoin/blob/master/doc/release-notes/release-notes-30.3.md), [31.0](https://github.com/bitcoin/bitcoin/blob/master/doc/release-notes/release-notes-31.0.md), [31.1](https://github.com/bitcoin/bitcoin/blob/master/doc/release-notes/release-notes-31.1.md), [29.4](https://github.com/bitcoin/bitcoin/blob/master/doc/release-notes/release-notes-29.4.md) · [32.0 draft](https://github.com/bitcoin-core/bitcoin-devwiki/wiki/32.0-Release-Notes-Draft) · [32.0 schedule](https://github.com/bitcoin/bitcoin/issues/35122) · [RPC docs 31.0.0](https://bitcoincore.org/en/doc/31.0.0/) · v31.1 tree: [example bitcoin.conf](https://github.com/bitcoin/bitcoin/blob/v31.1/share/examples/bitcoin.conf), [files.md](https://github.com/bitcoin/bitcoin/blob/v31.1/doc/files.md), [bitcoin-conf.md](https://github.com/bitcoin/bitcoin/blob/v31.1/doc/bitcoin-conf.md), [JSON-RPC-interface.md](https://github.com/bitcoin/bitcoin/blob/v31.1/doc/JSON-RPC-interface.md), [REST-interface.md](https://github.com/bitcoin/bitcoin/blob/v31.1/doc/REST-interface.md), [zmq.md](https://github.com/bitcoin/bitcoin/blob/v31.1/doc/zmq.md), [tor.md](https://github.com/bitcoin/bitcoin/blob/v31.1/doc/tor.md), [assumeutxo.md](https://github.com/bitcoin/bitcoin/blob/v31.1/doc/assumeutxo.md), [multiprocess.md](https://github.com/bitcoin/bitcoin/blob/v31.1/doc/multiprocess.md), [reduce-memory.md](https://github.com/bitcoin/bitcoin/blob/v31.1/doc/reduce-memory.md), [bips.md](https://github.com/bitcoin/bitcoin/blob/v31.1/doc/bips.md), [setup.nsi.in](https://github.com/bitcoin/bitcoin/blob/v31.1/share/setup.nsi.in), [guix build.sh](https://github.com/bitcoin/bitcoin/blob/v31.1/contrib/guix/libexec/build.sh), [codesign.sh](https://github.com/bitcoin/bitcoin/blob/v31.1/contrib/guix/libexec/codesign.sh), [init.cpp](https://github.com/bitcoin/bitcoin/blob/v31.1/src/init.cpp), [common/args.cpp](https://github.com/bitcoin/bitcoin/blob/v31.1/src/common/args.cpp), [common/config.cpp](https://github.com/bitcoin/bitcoin/blob/v31.1/src/common/config.cpp), [common/init.cpp](https://github.com/bitcoin/bitcoin/blob/v31.1/src/common/init.cpp), [httprpc.cpp](https://github.com/bitcoin/bitcoin/blob/v31.1/src/httprpc.cpp), [rpc/protocol.h](https://github.com/bitcoin/bitcoin/blob/v31.1/src/rpc/protocol.h), [rpc/request.cpp](https://github.com/bitcoin/bitcoin/blob/v31.1/src/rpc/request.cpp), [node/caches.cpp](https://github.com/bitcoin/bitcoin/blob/v31.1/src/node/caches.cpp), [kernel/chainparams.cpp](https://github.com/bitcoin/bitcoin/blob/v31.1/src/kernel/chainparams.cpp), [chainparamsbase.cpp](https://github.com/bitcoin/bitcoin/blob/v31.1/src/chainparamsbase.cpp), [bitcoin.cpp](https://github.com/bitcoin/bitcoin/blob/v31.1/src/bitcoin.cpp), [qt/winshutdownmonitor.cpp](https://github.com/bitcoin/bitcoin/blob/v31.1/src/qt/winshutdownmonitor.cpp), [qt/rpcconsole.cpp](https://github.com/bitcoin/bitcoin/blob/v31.1/src/qt/rpcconsole.cpp), [qt/optionsmodel.cpp](https://github.com/bitcoin/bitcoin/blob/v31.1/src/qt/optionsmodel.cpp), [CMakeLists.txt](https://github.com/bitcoin/bitcoin/blob/v31.1/CMakeLists.txt), [depends/Makefile](https://github.com/bitcoin/bitcoin/blob/v31.1/depends/Makefile), [windows-app.manifest.in](https://github.com/bitcoin/bitcoin/blob/v31.1/cmake/windows-app.manifest.in) · [guix.sigs](https://github.com/bitcoin-core/guix.sigs) · [detached signatures v31.1](https://github.com/bitcoin-core/bitcoin-detached-sigs/tree/v31.1/win) · [SECURITY.md](https://github.com/bitcoin/bitcoin/blob/master/SECURITY.md) · advisories [CVE-2024-52911](https://bitcoincore.org/en/2026/05/05/disclose-cve-2024-52911/), [wallet migration bug](https://bitcoincore.org/en/2026/01/05/wallet-migration-bug/), [private broadcast leak](https://bitcoincore.org/en/2026/06/06/privatebroadcast-ip-leak/), [relay statement](https://bitcoincore.org/en/2025/06/06/relay-statement/) · [issue #31388](https://github.com/bitcoin/bitcoin/issues/31388) · [Docker Hub bitcoin/bitcoin](https://hub.docker.com/r/bitcoin/bitcoin).

Bitcoin Knots: [website](https://bitcoinknots.org/) · [29.4.2 files](https://bitcoinknots.org/files/29.x/29.4.2.knots20260508/) · releases [29.4.2](https://github.com/bitcoinknots/bitcoin/releases/tag/v29.4.2.knots20260508), [29.4.1](https://github.com/bitcoinknots/bitcoin/releases/tag/v29.4.1.knots20260508), [29.4](https://github.com/bitcoinknots/bitcoin/releases/tag/v29.4.knots20260508), [29.3.knots20260508](https://github.com/bitcoinknots/bitcoin/releases/tag/v29.3.knots20260508), [29.3.knots20260507](https://github.com/bitcoinknots/bitcoin/releases/tag/v29.3.knots20260507) · [guix.sigs builder keys](https://github.com/bitcoinknots/guix.sigs/tree/knots/builder-keys) · v29.4.2 tree: [example bitcoin.conf](https://github.com/bitcoinknots/bitcoin/blob/v29.4.2.knots20260508/share/examples/bitcoin.conf), [chainparams.cpp](https://github.com/bitcoinknots/bitcoin/blob/v29.4.2.knots20260508/src/kernel/chainparams.cpp), [clientversion.h](https://github.com/bitcoinknots/bitcoin/blob/v29.4.2.knots20260508/src/clientversion.h), [setup.nsi.in](https://github.com/bitcoinknots/bitcoin/blob/v29.4.2.knots20260508/share/setup.nsi.in), [guix build.sh](https://github.com/bitcoinknots/bitcoin/blob/v29.4.2.knots20260508/contrib/guix/libexec/build.sh) · [bitcoin-blake2b.org](https://bitcoin-blake2b.org/) · [bip110.org](https://bip110.org/) · [BIP110](https://github.com/bitcoin/bips/blob/master/bip-0110.mediawiki) · [Optech #418](https://bitcoinops.org/en/newsletters/2026/08/14/) · [Optech #424](https://bitcoinops.org/en/newsletters/2026/09/25/) · [Docker Hub bitcoinknots/bitcoin](https://hub.docker.com/r/bitcoinknots/bitcoin).

Other: [Microsoft HandlerRoutine](https://learn.microsoft.com/en-us/windows/console/handlerroutine) · [Microsoft _chmod](https://learn.microsoft.com/en-us/cpp/c-runtime-library/reference/chmod-wchmod) · [NSIS command line](https://nsis.sourceforge.io/Docs/Chapter3.html) · [OpenPGP.js README v6.3.2](https://github.com/openpgpjs/openpgpjs/blob/v6.3.2/README.md), [message.js](https://github.com/openpgpjs/openpgpjs/blob/v6.3.2/src/message.js), [config.ts](https://github.com/openpgpjs/openpgpjs/blob/v6.3.2/src/config.ts) · [Sparrow connect-node docs](https://sparrowwallet.com/docs/connect-node.html) · [Sparrow BitcoindClient.java](https://github.com/sparrowwallet/sparrow/blob/master/src/main/java/com/sparrowwallet/sparrow/net/cormorant/bitcoind/BitcoindClient.java) · [JSON-RPC 2.0](https://www.jsonrpc.org/specification) · [OpenRPC](https://spec.open-rpc.org/).
