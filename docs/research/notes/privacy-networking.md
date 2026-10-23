# Tor, I2P, CJDNS, tunnels, remote access, reverse proxies and transaction privacy — technical reference (scope `privacy-networking`)

Verified on **2026-10-21**. Records: [`../data/privacy-networking.json`](../data/privacy-networking.json) (32 entries) and [`../data/standards-privacy-networking.json`](../data/standards-privacy-networking.json) (19 standards).

This is the reference for BTCortex's Tor & Privacy, Network Topology and Remote Infrastructure areas. Tor is a first-class integration (P1), so section 2 is written to be implemented from directly. Every statement was checked against a primary source fetched on the verification date — release directories, signatures and keys (read as text, never imported), source code at the release tag, official specifications and documentation. Where something could not be verified it says so, and the JSON records list it under `unverifiedClaims`.

Owned entries: `tor`, `tor-browser`, `arti`, `lyrebird`, `conjure`, `obfs4proxy`, `i2pd`, `i2p`, `cjdns`, `wireguard`, `tailscale`, `headscale`, `zerotier`, `netbird`, `openssh`, `cloudflared`, `frp`, `caddy`, `nginx`, `mkcert`, `stunnel`, `payjoin-cli`, `payjoin-dev-kit`, `payjoin-mailroom`, `joinmarket`, `joinmarket-ng`, `jam`, `wabisabi-coordinator`, `samourai-whirlpool`, `joinstr`, `frigate`, `blindbit-oracle`.

Projects owned by other scopes are referred to by canonical id only: `bitcoin-core`, `bitcoin-knots`, `fulcrum`, `electrs`, `sparrow`, `electrum`, `specter-desktop`, `wasabi-wallet`, `ashigaru-terminal`, `whirlpool-gui`, `btcpay-server`, `lnd`, `core-lightning`, `bitbox02`, `gpg4win`.

---

## 0. Key facts at a glance

| Item | Fact (2026-10-21) |
|---|---|
| Tor daemon for Windows | **Tor Expert Bundle 15.0.25** containing **tor 0.4.9.14**; files on dist.torproject.org dated **2026-10-12**; tor 0.4.9.14 itself released **2026-10-07** as a security release ([download page](https://download.torproject.org/tor/), [directory](https://dist.torproject.org/torbrowser/15.0.25/), [ChangeLog](https://gitlab.torproject.org/tpo/core/tor/-/raw/tor-0.4.9.14/ChangeLog)) |
| URL pattern | `https://dist.torproject.org/torbrowser/<V>/tor-expert-bundle-windows-<x86_64\|i686>-<V>.tar.gz` plus `.asc`; signed checksums in `https://dist.torproject.org/torbrowser/<V>/sha256sums-signed-build.txt(.asc)`; older versions under `https://archive.torproject.org/tor-package-archive/torbrowser/<V>/` |
| Verification | Detached OpenPGP signature by the **Tor Browser Developers (signing key) &lt;torbrowser@torproject.org&gt;**, primary fingerprint **EF6E 286D DA85 EA2A 4BA7 DE68 4E2C 6E87 9329 8290**; 15.0.25 signed by subkey **022D A248 432D 2A0E 0F54 E65E 316C 1FAC D62D 07D9** (created 2026-08-11, expires 2028-11-28). The previous signing subkey CAAE 408A EBE2 288E 96FC 5D5E 1574 32CF 78A6 5729 expires **2026-10-26** |
| Authenticode | **tor.exe is not Authenticode-signed** (empty PE certificate table in 15.0.25) |
| Running as a Windows service | `tor --service install` exists but **requires administrator rights**, installs a single service named `tor` running as `NT AUTHORITY\LocalService`; not usable for per-user zero-touch operation |
| Recommendation | Per-user child process `tor.exe` launched and owned by BTCortex (the pattern Tor Browser's launcher uses), SAFECOOKIE control authentication, bootstrap through `STATUS_CLIENT` events |
| C tor vs Arti | **C tor now.** Arti 2.7.0 (2026-10-01) has no official binaries, no C-tor control port, and its own onion-service document still calls hosting "suitable for testing and experimentation only" |
| I2P | **i2pd 3.0.0** (2026-10-20; SAM on by default) for managed use; Java **I2P 2.13.0** (2026-07-20; SAM off by default) as connected application |
| CJDNS | No Windows binaries; cross-compile, TAP driver and elevation required → research-only |
| Tunnels | WireGuard for Windows **1.1.1** (2026-09-20), Tailscale **1.104.2** (2026-10-21), ZeroTier 1.16.2, NetBird 0.81.3 — Windows clients install drivers or services with administrator rights; Headscale 0.29.5 is Linux/macOS/FreeBSD server software. Encrypted tunnels or private networks, **never anonymity** |
| Reverse proxy | **Caddy 2.11.7** (portable ZIP, Sigstore-signed checksums) recommended; nginx/Windows is officially beta |
| Transaction privacy | **JoinMarket (joinmarket-clientserver) archived 2026-04-27** after its final release 0.9.12; JoinMarket NG 0.42.1 and Jam 2.0 betas are the active line; BIP 77 still Draft; Frigate 1.6.1 needs `txindex=1` |

**Contradictions with the specification's assumptions** (details in §11): "Tor service lifecycle management" cannot mean a Windows service without administrator rights; CJDNS is not realistically deployable natively on Windows; JoinMarket's original implementation is discontinued; every VPN or mesh tool needs elevation; silent-payment indexing is impossible on a pruned node.

---

## 1. Landscape: anonymity networks, encrypted tunnels and private networks

The specification demands this distinction be explicit (section 10.1). BTCortex should label every connection with exactly one of these classes in the topology view and never call a VPN "anonymous".

| Class | Members | What it hides | What it does not hide | BTCortex label |
|---|---|---|---|---|
| **Anonymity network** | Tor (`tor`, `arti`), I2P (`i2pd`, `i2p`) | The user's IP address from destinations; with onion/I2P services, the server's location too; from the ISP, which destinations are contacted | That Tor/I2P is used (unless bridges); traffic timing to a global observer; anything the application itself reveals (addresses, xpubs). I2P receivers see the initiator's I2P destination ([Core i2p.md](https://github.com/bitcoin/bitcoin/blob/v31.1/doc/i2p.md)) | "Anonymity network" |
| **Encrypted overlay without anonymity** | CJDNS | Content from intermediate routers (end-to-end encryption) | Sender and recipient from intermediate routers: "CJDNS is fast but does not hide the sender and the recipient from intermediate routers" ([Core cjdns.md](https://github.com/bitcoin/bitcoin/blob/v31.1/doc/cjdns.md)) | "Encrypted mesh" |
| **Encrypted tunnel / VPN** | WireGuard, OpenSSH port forwarding, commercial VPNs | Content and destinations from the local network and ISP | Everything from the tunnel endpoint operator; the user's identity to that operator | "Encrypted tunnel" |
| **Private network (managed mesh)** | Tailscale, Headscale, ZeroTier, NetBird | Content between members; services are reachable only by members | Membership, keys and public IPs from the coordination server operator; Tailscale HTTPS names in Certificate Transparency logs | "Private network" |
| **Hosted reverse tunnel** | Cloudflare Tunnel (`cloudflared`), `frp`, Tailscale Funnel | The origin's IP address from visitors | Traffic metadata (and possibly content) from the relay operator; the endpoint becomes public | "Public endpoint via third party" |
| **Local TLS** | Caddy, stunnel, nginx | Content on the LAN | Nothing about who connects | "TLS" |

Transaction-level privacy (Payjoin, CoinJoin, silent payments) is orthogonal: network anonymity does not stop chain analysis, and transaction privacy does not hide the IP address.

---

## 2. Tor integration reference

### 2.1 Which Tor

| Option | Verdict | Why |
|---|---|---|
| **Tor Expert Bundle (C tor)** | **Use** | The Tor Project's official standalone tor for Windows: "The Expert Bundle includes the tor and pluggable transports binaries, bridge strings, and geoip data used in Tor Browser", "Recommended for developers and advanced users only" ([download page](https://download.torproject.org/tor/); www.torproject.org/download/tor/ redirects there) |
| Tor Browser's tor | Do not depend on it | Runs only while the browser runs, owned by the browser through `__OwningControllerProcess`, ports 9150/9151, configuration managed and overwritten by the browser, updated on its own schedule (§2.19) |
| Arti | Not yet | No official binaries, no control port, onion-service hosting not production-ready (§2.20) |
| `tor --service install` | Avoid | Administrator only, LocalService account, single fixed service name (§2.7) |
| Tor inside WSL2/Docker | Unnecessary | Native build exists; the test machine has neither WSL2 nor Docker |

### 2.2 Current release and lifecycle

- **tor 0.4.9.14 — 2026-10-07.** "Another week, another security release. This again contains major bugfixes related to high severity issues. The fixes affect all Tor components: relay, client, onion service and authority. We strongly recommend upgrading as soon as possible." Fixes include conflux/rendezvous assertion crashes, the MiddleOnly flag being ignored by non-authorities (TROVE-2026-067), family-certificate expiry (TROVE-2026-062), circuit-build-timeout stalls and an inverted `HiddenServiceAllowUnknownPorts` ([ChangeLog](https://gitlab.torproject.org/tpo/core/tor/-/raw/tor-0.4.9.14/ChangeLog)).
- **Series** ([CoreTorReleases](https://gitlab.torproject.org/tpo/core/team/-/wikis/NetworkTeam/CoreTorReleases)): 0.4.9 stable since 2026-02-12, end of life "TBD"; **0.4.8 end of life 2026-06-01**; 0.5.0 merge window opened 2026-03-25.
- **Expert Bundle 15.0.25 — 2026-10-12**, built with Tor Browser 15.0.25 ("Updated Tor to 0.4.9.14", OpenSSL 3.5.9; [blog](https://blog.torproject.org/new-release-tor-browser-15025/)). The download page also lists the alpha 16.0a14 (tor 0.4.9.14); BTCortex must follow the stable channel only.
- **Windows versions:** not stated for the Expert Bundle. Tor Browser dropped Windows 7, 8 and 8.1 with Tor Browser 14 and recommends Windows 10 or 11; Tor Browser 16.0 "drops support for 32-bit x86 platforms" ([legacy OS FAQ](https://support.torproject.org/tor-browser/security/legacy-os)), so the `i686` Expert Bundle may disappear. There is **no Windows ARM64 Expert Bundle**.
- Practical consequence: tor ships security releases often (the 0.4.9.14 notes open with "Another week, another security release"). BTCortex's update channel for tor must be fast and automatic, with the same verification every time.

### 2.3 Download URL pattern and version discovery

1. Discover the current stable version, either from the download page or from Tor Browser's machine-readable [downloads.json](https://aus1.torproject.org/torbrowser/update_3/release/downloads.json) (`"version": "15.0.25"` on 2026-10-21). The Expert Bundle version follows Tor Browser's version.
2. Build the URLs (architecture `x86_64` or `i686`):
   - `https://dist.torproject.org/torbrowser/<V>/tor-expert-bundle-windows-<arch>-<V>.tar.gz`
   - `https://dist.torproject.org/torbrowser/<V>/tor-expert-bundle-windows-<arch>-<V>.tar.gz.asc`
   - `https://dist.torproject.org/torbrowser/<V>/sha256sums-signed-build.txt` and `.asc`
3. dist.torproject.org keeps only recent versions (15.0.20, 15.0.25 and 16.0a14 on 2026-10-21; [listing](https://dist.torproject.org/torbrowser/)). For pinned or older versions use `https://archive.torproject.org/tor-package-archive/torbrowser/<V>/` (HTTP 200 for 15.0.20 and 15.0.25 on 2026-10-21).
4. All downloads over HTTPS with certificate validation; never accept a version lower than the installed one (downgrade protection) and require the version in the file name to equal the version requested.

### 2.4 Archive layout (Windows x86_64, 15.0.25)

Listed by streaming the archive through `tar -tzv` without writing it to disk; SHA-256 of the stream `c1988c701de2f24f7d098d1d6d7f507b58f27740d097f29c246e0524d639b252` matches `sha256sums-signed-build.txt`.

```
data/geoip                                   9 775 942 bytes
data/geoip6                                 16 599 769
data/torrc-defaults                               928   (Tor Browser's defaults — do not use as is)
docs/conjure.txt docs/libevent.txt docs/lyrebird.txt docs/openssl.txt docs/tor.txt docs/zlib.txt   (licences)
tor/pluggable_transports/README.CONJURE.md
tor/pluggable_transports/conjure-client.exe  13 140 480
tor/pluggable_transports/lyrebird.exe        17 957 376
tor/pluggable_transports/pt_config.json           2 668
tor/tor-gencert.exe                           6 203 904   (directory-authority tool; not needed)
tor/tor.exe                                  10 237 952
```

- No DLLs: tor.exe is statically linked against libevent, OpenSSL and zlib (their licences are in `docs/`). There is no `snowflake-client.exe`: Snowflake has been part of lyrebird since lyrebird 0.5.0 ([ChangeLog](https://gitlab.torproject.org/tpo/anti-censorship/pluggable-transports/lyrebird/-/blob/main/ChangeLog)).
- Archive entries use `root/root` owners, mode `rwx------`/`rw-------` and a fixed 2000-01-01 timestamp (reproducible build).
- `data/torrc-defaults` is **Tor Browser's** defaults file ("DO NOT EDIT … distributed with Tor Browser"): `AvoidDiskWrites 1`, `Log notice stdout`, `CookieAuthentication 1`, `DormantCanceledByStartup 1` and `ClientTransportPlugin … exec TorBrowser\Tor\PluggableTransports\lyrebird.exe`. Those paths do not exist in the Expert Bundle, so **BTCortex must write its own transport lines** (§2.15).
- `pt_config.json`: `"recommendedDefault": "obfs4"`; transport lines for `lyrebird` (meek_lite, obfs2, obfs3, obfs4, scramblesuit, webtunnel), `snowflake` (also lyrebird.exe) and `conjure` (`conjure-client.exe -registerURL https://registration.refraction.network/api`); built-in bridge lines: 1 meek, 7 obfs4, 2 Snowflake; **no built-in WebTunnel bridges**.

### 2.5 Verification procedure, step by step

The signature format is the same as Bitcoin Core's, so BTCortex can reuse the OpenPGP.js verifier described in `full-nodes-core` notes §3.4, with a different pinned key.

Signature facts read from the packets (no keyring used): the `.asc` files for the Expert Bundle and for `sha256sums-signed-build.txt` are single version-4 signatures of type 0x00 (binary document), RSA, SHA-512, issuer fingerprint subpacket `022DA248432D2A0E0F54E65E316C1FACD62D07D9`, created 2026-10-12 23:16 UTC. Parsing the key served by [keys.openpgp.org](https://keys.openpgp.org/vks/v1/by-fingerprint/EF6E286DDA85EA2A4BA7DE684E2C6E8793298290) and by the Tor Project's [WKD URL](https://openpgpkey.torproject.org/.well-known/openpgpkey/torproject.org/hu/kounek7zrdx745qydx6p59t9mqjpuhdf) shows:

| Key | Fingerprint | Created | Expires | Use |
|---|---|---|---|---|
| Primary "Tor Browser Developers (signing key) &lt;torbrowser@torproject.org&gt;" | `EF6E 286D DA85 EA2A 4BA7 DE68 4E2C 6E87 9329 8290` (as published on the [verification page](https://support.torproject.org/tbb/how-to-verify-signature/)) | 2014-12-15 | 2030-11-18 (latest self-signature 2026-08-11) | Certification |
| Signing subkey (current) | `022D A248 432D 2A0E 0F54 E65E 316C 1FAC D62D 07D9` | 2026-08-11 | 2028-11-28 | Signs 15.0.25 |
| Signing subkey (previous) | `CAAE 408A EBE2 288E 96FC 5D5E 1574 32CF 78A6 5729` | 2024-07-15 | 2026-10-26 (WKD copy) | Older releases |

The Tor Project publishes only the primary fingerprint; the subkeys above were derived from the published key. For comparison, the **source tarball** checksum `tor-0.4.9.14.tar.gz.sha256sum.asc` carries two signatures, by David Goulet (`B744 17ED DF22 AC9F 9E90 F491 42E8 6A2A 11F4 8D36`) and Alexander Færøy (signing subkey `5141 0245 4D0A 87DB 0767 A1EB BE6A 0531 C18A 9179`, primary `1C1B C007 A9F6 07AA 8152 C040 BEA7 B180 B149 1921`); the Tor Project lists Færøy, Goulet and Nick Mathewson (`2133 BC60 0AB1 33E1 D826 D173 FE43 009C 4607 B1FB`) as possible tarball signers ([little-t-tor verification](https://support.torproject.org/little-t-tor/verify-little-t-tor/)). BTCortex does not need the source keys unless it builds tor itself.

Procedure:

1. **Pin** the primary fingerprint `EF6E286DDA85EA2A4BA7DE684E2C6E8793298290` in BTCortex and ship the armoured public key (from WKD or keys.openpgp.org) with the application.
2. **Refresh** the key before each verification (WKD URL above, keys.openpgp.org as fallback) and accept the refreshed key only if its primary fingerprint equals the pinned one. This is needed because signing subkeys rotate (a new one appeared on 2026-08-11 and the previous one expires on 2026-10-26).
3. **Download** `tor-expert-bundle-windows-<arch>-<V>.tar.gz.asc` and `sha256sums-signed-build.txt` with its `.asc`; keep the checksum file as raw bytes (the signature is binary-mode).
4. **Verify** both signatures with OpenPGP.js: the signing key must be a subkey of the pinned primary, valid at the signature's creation time (OpenPGP.js checks validity at creation time, see `full-nodes-core` §3.4); reject any other issuer.
5. **Parse** `sha256sums-signed-build.txt` strictly (`^[0-9a-f]{64}  <name>$`, 52 lines for 15.0.25, no duplicate names) and look up exactly `tor-expert-bundle-windows-<arch>-<V>.tar.gz`.
6. **Download and hash** the archive (streaming SHA-256); require both the detached-signature check (step 4 against the archive bytes) and the checksum match. Delete on mismatch.
7. **Extract** in-process with path validation (reject absolute paths, `..`, links and unexpected entries; expect exactly the layout in §2.4) into `%LOCALAPPDATA%\BTCortex\runtimes\tor\<V>\`; switch the active version atomically after a `tor.exe --version` smoke test.
8. **Record** a verification report (version, URLs, issuer subkey, signature time, checksums) for the audit log.
9. Authenticode cannot be used as a second check because the executables are unsigned. Optional extra assurance: `sha256sums-unsigned-build.txt` is additionally signed by individual builders (`.asc-ma1`, issuer `3359 0391 70A3 CD9B 25CF 5A46 231A 83AF DA9C 2434`; `.asc-pierov`, EdDSA issuer `021C E13D 28B3 B67F 9F7C 7BC1 F075 6D17 9012 8891`); whether to pin builder keys is an open question.

### 2.6 Installation layout on Windows (no administrator rights)

| Path | Content | Notes |
|---|---|---|
| `%LOCALAPPDATA%\BTCortex\runtimes\tor\<V>\` | Extracted bundle (read-only after install) | Keep previous version for rollback |
| `%LOCALAPPDATA%\BTCortex\tor\torrc`, `torrc-defaults` | Generated configuration | Regenerated on each start |
| `%LOCALAPPDATA%\BTCortex\tor\data\` | `DataDirectory`: state, caches, `lock`, `control_auth_cookie` | tor's own default would be the roaming Application Data folder |
| `%LOCALAPPDATA%\BTCortex\tor\onion-auth\` | `ClientOnionAuthDir` (`*.auth_private`) | Secrets: restrict ACL |
| `%LOCALAPPDATA%\BTCortex\tor\hs\<service>\` | `HiddenServiceDir` (if file-based services are used) | Contains `hs_ed25519_secret_key` |

`%LOCALAPPDATA%` is per user and not readable by other standard users by default, which is what protects the cookie and keys: the manual notes that `HiddenServiceDirGroupReadable` "Has no effect on Windows" ([manual](https://gitlab.torproject.org/tpo/core/tor/-/raw/tor-0.4.9.14/doc/man/tor.1.txt)). Keep the base path short and ASCII-only (§2.9).

### 2.7 Running tor per user, and why not as a Windows service

**Service mode, read from source** ([ntmain.c](https://gitlab.torproject.org/tpo/core/tor/-/blob/tor-0.4.9.14/src/app/main/ntmain.c)): `tor --service install [--options …]` creates service `tor`, display name "Tor Win32 Service", `SERVICE_AUTO_START`, running as `NT AUTHORITY\LocalService` unless `--user/--password` are given, with command line `"<tor.exe>" --nt-service <options>`. Every `--service` action opens the service control manager with `SC_MANAGER_CREATE_SERVICE`, and "Only processes with Administrator privileges are able to open handles to the SCM that can be used by the CreateService" function ([Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/services/service-security-and-access-rights)). tor itself warns that without `-f` the service "will look for its configuration file under that account's Application Data directory". Consequences for BTCortex: administrator rights for install, start, stop and removal; one service name per machine (conflicts with any other tor service); the cookie and keys live in LocalService's profile, unreadable for the user's Bitcoin Core (which reads the cookie path from PROTOCOLINFO); and it violates the zero-touch, no-administrator goal. **Do not use it.**

**Per-user child process (recommended)** — the same model Tor Browser uses ([TorProcess.sys.mjs](https://gitlab.torproject.org/tpo/applications/tor-browser/-/blob/tor-browser-140.7.0esr-15.0-1/toolkit/components/tor-launcher/TorProcess.sys.mjs)): Tor Browser starts tor with `-f <torrc>`, `DataDirectory`, `ClientOnionAuthDir`, `--defaults-torrc`, `GeoIPFile` and `GeoIPv6File`, `+__ControlPort <port>`, `CookieAuthentication 1`, `CookieAuthFile <path>`, `+__SocksPort "<port> <flags>"`, `__OwningControllerProcess <its pid>` and, while network settings are being chosen, `DisableNetwork 1`. All path-valued options travel as separate command-line arguments, which sidesteps torrc quoting entirely.

Recommended launch (argument vector, each item a separate argument, working directory = the bundle root):

```
tor\tor.exe
  -f                      C:\Users\<u>\AppData\Local\BTCortex\tor\torrc
  --defaults-torrc        C:\Users\<u>\AppData\Local\BTCortex\tor\torrc-defaults
  DataDirectory           C:\Users\<u>\AppData\Local\BTCortex\tor\data
  CookieAuthFile          C:\Users\<u>\AppData\Local\BTCortex\tor\data\control_auth_cookie
  ClientOnionAuthDir      C:\Users\<u>\AppData\Local\BTCortex\tor\onion-auth
  GeoIPFile               <bundle>\data\geoip
  GeoIPv6File             <bundle>\data\geoip6
  __OwningControllerProcess <PID of the BTCortex supervisor>
```

- Start with `CREATE_NO_WINDOW`, capture stdout (`Log notice stdout`) into BTCortex's central log with redaction, and put the process in a Job Object with kill-on-close so that a crash of the supervisor cannot leave tor running.
- `__OwningControllerProcess` makes tor "periodically check for presence of a controller process with given PID and terminate itself if this process is no longer alive. Polling interval is 15 seconds" ([manual](https://gitlab.torproject.org/tpo/core/tor/-/raw/tor-0.4.9.14/doc/man/tor.1.txt)).
- The control specification's recommended sequence is `TAKEOWNERSHIP` on the controller's connection followed by `RESETCONF __OwningControllerProcess`, after which tor exits when that connection closes ([TAKEOWNERSHIP](https://spec.torproject.org/control-spec/commands.html)). BTCortex should keep one long-lived "owner" connection for this and use separate connections for queries, so that a query bug cannot kill tor.
- Pass an explicit `--defaults-torrc` (BTCortex's own, possibly empty) so that no stray defaults file is picked up; never use the bundle's Tor Browser `torrc-defaults`.

### 2.8 Recommended minimal torrc (per-user, BTCortex-managed)

Path-free options only; paths are on the command line (§2.7).

```
# Managed by BTCortex. Regenerated on every start; manual edits are overwritten.
# Listeners stay on loopback. One SocksPort per application class gives stream isolation between them.
SocksPort 127.0.0.1:9050 IsolateSOCKSAuth
SocksPort 127.0.0.1:9052 IsolateSOCKSAuth
ControlPort 127.0.0.1:9051
CookieAuthentication 1
# Logs go to stdout and are written by BTCortex's log pipeline (rotation, redaction).
Log notice stdout
SafeLogging 1

# Optional, only after the user enables remote wallet access to the local Electrum server:
# HiddenServiceDir <passed per service; see §2.13>
# HiddenServicePort 50001 127.0.0.1:50001
# HiddenServicePoWDefensesEnabled 1

# Optional, only when bridges are needed (working directory = bundle root, relative path has no spaces):
# UseBridges 1
# ClientTransportPlugin meek_lite,obfs2,obfs3,obfs4,scramblesuit,webtunnel exec tor\pluggable_transports\lyrebird.exe
# ClientTransportPlugin snowflake exec tor\pluggable_transports\lyrebird.exe
# Bridge obfs4 <ip:port> <fingerprint> cert=<...> iat-mode=0
```

| Key | Value and reason ([manual](https://gitlab.torproject.org/tpo/core/tor/-/raw/tor-0.4.9.14/doc/man/tor.1.txt)) |
|---|---|
| `SocksPort` | Default 9050. "Although this option allows you to specify an IP address other than localhost, you should do so only with extreme caution … exposing it in this way could leak your information … and allow anybody to use your computer as an open proxy." Multiple entries are isolated from each other by default; `IsolateSOCKSAuth` is on by default (listed for clarity). Use 9050 for Bitcoin Core and a second port (9052 above) for wallets and other clients; `DANGEROUS_SOCKS` warnings can then be attributed per application |
| `ControlPort` | "unless you also specify one or more of HashedControlPassword or CookieAuthentication, setting this option will cause Tor to allow any process on the local host to control it." TCP only on Windows (`ControlSocket` is "Unix and Unix-like systems only") |
| `CookieAuthentication` / `CookieAuthFile` | 32-byte cookie, regenerated on startup; enables COOKIE and SAFECOOKIE. Prefer cookie over `HashedControlPassword` (nothing to store); a password is only needed for a client that cannot read the file |
| `HashedControlPassword` | Output of `tor --hash-password <pw>` (`16:` + salted S2K hash). Use only for remote or differently privileged controllers |
| `DataDirectory` | "Can not be changed while tor is running." Default on Windows: "your ApplicationData folder" — always set explicitly |
| `ClientOnionAuthDir` | Files `<name>.auth_private` containing `<56-char-onion-addr-without-.onion>:descriptor:x25519:<base32 private key>` for onion services that require client authorisation |
| `GeoIPFile`, `GeoIPv6File` | From the bundle's `data\`; needed for country-based node selection and statistics |
| `Log` | Notice level: "We advise using 'notice' in most cases, since anything more verbose may provide sensitive information to an attacker who obtains the logs" |
| `__OwningControllerProcess` | Command line only in BTCortex's design (controller-specific option, not saved by SAVECONF) |
| `DisableNetwork 1` | Start configured but offline, for example while the user chooses bridges |
| `DormantCanceledByStartup` | Leave at default 0: the manual reserves it for starts caused by "affirmative user activity", not autostart at login. A client becomes dormant after `DormantClientTimeout` (24 h) without client activity; this "does not affect servers or onion services" |

### 2.9 torrc syntax pitfalls on Windows

- "To split one configuration entry into multiple lines, use a single backslash character (\\) before the end of the line" — a Windows path ending in `\` silently joins the next line. Never end a value with a backslash.
- "C-style escaped characters are allowed inside quoted values", so a quoted Windows path needs doubled backslashes (`"C:\\Users\\…"`). Values that contain spaces (user names such as "John Smith") need quoting; multi-token options such as `Log`, `ClientTransportPlugin` and `HiddenServicePort` cannot simply be quoted as a whole. This is why paths go on the command line and transport paths are relative to the working directory.
- `%include` wildcards cannot be escaped on Windows; BTCortex does not need `%include` (it also disables `SAVECONF` writing).
- A command-line option replaces **all** instances of the same option in the torrc; prefix with `+` to append and `/` to remove. Keep each multi-valued option (SocksPort, HiddenServiceDir/Port pairs) in one place.
- **Non-ASCII paths:** tor issue [#10416](https://gitlab.torproject.org/tpo/core/tor/-/issues/10416), "Tor won't start on Windows when path contains non-ascii characters", is **still open** (updated 2025-12-02); the proposed fix [MR !357](https://gitlab.torproject.org/tpo/core/tor/-/merge_requests/357) (use 8.3 short paths) was closed unmerged on 2023-09-14. User profiles with non-ASCII names are common outside English-speaking countries. BTCortex must detect a non-ASCII base path and test a mitigation (8.3 short path from `GetShortPathNameW`, if 8.3 names are enabled on the volume, or an ASCII-only base directory with tightened ACLs) before claiming support.

### 2.10 Control-port authentication

Message format: commands are CRLF-terminated lines; replies use three-digit codes ("250 OK", multi-line "250-key=value", data blocks "250+key=" ending with "."), asynchronous events use 650 ([replies](https://spec.torproject.org/control-spec/replies.html)). Before authentication only `PROTOCOLINFO`, `AUTHCHALLENGE`, `AUTHENTICATE` and `QUIT` are allowed; anything else, or a failed AUTHENTICATE, makes tor reply with an error and close the connection ([AUTHENTICATE](https://spec.torproject.org/control-spec/commands.html)).

SAFECOOKIE, the method BTCortex should implement (it is also what Bitcoin Core uses when no password is set — [torcontrol.cpp](https://github.com/bitcoin/bitcoin/blob/v31.1/src/torcontrol.cpp)):

1. `PROTOCOLINFO 1` → `250-PROTOCOLINFO 1`, `250-AUTH METHODS=COOKIE,SAFECOOKIE COOKIEFILE="C:\\…\\control_auth_cookie"`, `250-VERSION Tor="0.4.9.14"`, `250 OK`. Unescape the quoted path; ignore unknown lines.
2. Read the cookie; it must be exactly 32 bytes ("Controllers MUST NOT use the contents of a non-32-byte-long file as an authentication cookie"). Check that the path is the one BTCortex configured.
3. Send `AUTHCHALLENGE SAFECOOKIE <64 hex chars of a random 32-byte client nonce>`.
4. Receive `250 AUTHCHALLENGE SERVERHASH=<64 hex> SERVERNONCE=<64 hex>`.
5. Verify in constant time: `SERVERHASH == HMAC-SHA256(key = "Tor safe cookie authentication server-to-controller hash", message = cookie ‖ clientNonce ‖ serverNonce)`. A mismatch means the port is not the expected tor (or the cookie is wrong): abort.
6. Send `AUTHENTICATE <hex of HMAC-SHA256(key = "Tor safe cookie authentication controller-to-server hash", message = cookie ‖ clientNonce ‖ serverNonce)>`.
7. Expect `250 OK`; `515 Bad authentication` closes the connection.

COOKIE (sending the cookie itself) "has been deprecated and will be removed from a future version of Tor" because it leaks the cookie to whatever is listening on the port; HASHEDPASSWORD sends the clear password (`AUTHENTICATE "<password>"`); NULL must never be accepted by BTCortex (if PROTOCOLINFO reports `METHODS=NULL` on a port BTCortex did not configure, warn the user that any local process can control that tor).

### 2.11 Control commands for health checks

| Command | Expected | Use |
|---|---|---|
| `GETINFO version` | `250-version=0.4.9.14 …` | Inventory and update checks |
| `GETINFO status/version/current` | `recommended`, `new`, `old`, `unrecommended`, `obsolete`, … | Prompt an update when the directory authorities no longer recommend the version |
| `GETINFO status/bootstrap-phase` | `NOTICE BOOTSTRAP PROGRESS=100 TAG=done SUMMARY="Done"` | Current state after (re)connecting |
| `GETINFO status/circuit-established` | `1` | Tor can build circuits |
| `GETINFO status/enough-dir-info` | `1` | Directory information complete |
| `GETINFO network-liveness` | `up` / `down` | Network reachability as seen by tor |
| `GETINFO dormant` | `0` | Non-zero means idle; `SIGNAL ACTIVE` wakes it |
| `GETINFO net/listeners/socks` | `"127.0.0.1:9050" "127.0.0.1:9052"` | Confirm listeners |
| `GETINFO process/pid` | PID | Correlate with the supervised process (`process/user` is unimplemented on Windows) |
| `GETINFO onions/current`, `onions/detached` | Service IDs | Onion services created over this connection / detached ones |
| `GETINFO hs/service/desc/id/<addr>` | Descriptor | Confirms a local service has built its descriptor |
| `GETINFO traffic/read`, `traffic/written`, `uptime` | Counters | Dashboard |
| `SETEVENTS STATUS_CLIENT STATUS_GENERAL HS_DESC NETWORK_LIVENESS` | 650 events | Bootstrap, warnings, onion-service publication, liveness |
| `SIGNAL NEWNYM` | `250 OK` | New circuits for subsequent streams (tor may rate-limit) |

Useful status events ([replies](https://spec.torproject.org/control-spec/replies.html)): `STATUS_CLIENT BOOTSTRAP`, `CIRCUIT_ESTABLISHED`, `CIRCUIT_NOT_ESTABLISHED`, `ENOUGH_DIR_INFO`, `DANGEROUS_SOCKS` (an application sent a raw IP through SOCKS — "it may be leaking target addresses via DNS"; expected for Bitcoin Core's IP peers, which is why Core gets its own SocksPort), `SOCKS_BAD_HOSTNAME`, `SOCKS_UNKNOWN_PROTOCOL`; `STATUS_GENERAL CLOCK_SKEW` (with `SKEW` and `SOURCE`; "Controllers shouldn't blindly adjust the clock"), `CLOCK_JUMPED` (sleep/resume), `DANGEROUS_VERSION`, `BUG`.

### 2.12 Bootstrap monitoring

Events have the form `650 STATUS_CLIENT NOTICE BOOTSTRAP PROGRESS=<0-100> TAG=<tag> SUMMARY="<text>"`; problems arrive as `650 STATUS_CLIENT WARN BOOTSTRAP … WARNING="…" REASON=<keyword> COUNT=<n> RECOMMENDATION=ignore|warn [HOST=… HOSTADDR=…]` ([STATUS events](https://spec.torproject.org/control-spec/replies.html)). Tor uses `RECOMMENDATION=ignore` for the first nine problem reports of a phase and `warn` afterwards. Phases for current versions ([bootstrap phases](https://spec.torproject.org/control-spec/implementation-notes.html)):

| Progress | Tag | Meaning |
|---|---|---|
| 0 | `starting` | Start |
| 1 / 2 | `conn_pt` / `conn_done_pt` | Connecting to / connected to a pluggable transport |
| 3 / 4 | `conn_proxy` / `conn_done_proxy` | Upstream proxy |
| 5 / 10 | `conn` / `conn_done` | First relay or bridge |
| 14 / 15 | `handshake` / `handshake_done` | TLS handshake |
| 20 | `onehop_create` | Encrypted directory connection |
| 25 / 30 | `requesting_status` / `loading_status` | Consensus |
| 40 | `loading_keys` | Authority certificates |
| 45 / 50 | `requesting_descriptors` / `loading_descriptors` | Relay descriptors (bulk of the time on slow links) |
| 75 | `enough_dirinfo` | Enough directory information |
| 76–90 | `ap_conn_pt` … `ap_handshake_done` | Connections for application circuits |
| 95 | `circuit_create` | Building a 3-hop circuit |
| 100 | `done` | Ready for application connections |

"Only 'starting' and 'done' are guaranteed to exist in all future versions" — the UI must show the summary text and progress without hard-coding tags, and use tags only for diagnosis. Algorithm:

1. Connect, authenticate, `SETEVENTS STATUS_CLIENT STATUS_GENERAL NETWORK_LIVENESS HS_DESC`, then `GETINFO status/bootstrap-phase` (events before the subscription are otherwise missed).
2. Ready when `PROGRESS=100` and `GETINFO status/circuit-established` returns 1; only then start or reconfigure Tor-dependent services (Bitcoin Core with `onlynet=onion`, wallets pointed at onion servers).
3. Stall detection: no progress for 120 s, or any `WARN BOOTSTRAP … RECOMMENDATION=warn`, or `CLOCK_SKEW` → show the reason and offer remedies (fix the clock, try Snowflake or obfs4 bridges, check the firewall or proxy).
4. Keep listening after bootstrap: `CIRCUIT_NOT_ESTABLISHED`, `NETWORK_LIVENESS DOWN` and `CLOCK_JUMPED` (after sleep) change the health state.

### 2.13 Onion services

Two mechanisms; both produce v3 services (56-character addresses; only version 3 is supported):

| | `HiddenServiceDir` / `HiddenServicePort` in torrc | `ADD_ONION` over the control port |
|---|---|---|
| Persistence | Survives tor restarts by itself | Lives until `DEL_ONION`, tor exit, or closure of the creating connection unless `Flags=Detach` |
| Key storage | `hs_ed25519_secret_key` in the directory (plaintext file, protected by NTFS ACL) | BTCortex stores `PrivateKey=ED25519-V3:<base64>` itself, for example DPAPI-encrypted, and re-adds it after each tor start |
| Windows path issues | Yes (§2.9) | None |
| PoW defences | `HiddenServicePoWDefensesEnabled 1` (+ `HiddenServicePoWQueueRate` 250, `HiddenServicePoWQueueBurst` 2500 defaults) | `PoWDefensesEnabled=1` (since 0.4.9.2-alpha) |
| Client authorisation | `<dir>\authorized_clients\<name>.auth` containing `descriptor:x25519:<base32 public key>` | `ClientAuthV3=<base32 public key>` |

Recommendation: **ADD_ONION with keys in BTCortex's encrypted store**, because BTCortex supervises tor anyway, avoids plaintext key files and all Windows path quoting. Commands ([ADD_ONION, DEL_ONION](https://spec.torproject.org/control-spec/commands.html)):

```
ADD_ONION NEW:ED25519-V3 Flags=Detach PoWDefensesEnabled=1 Port=50001,127.0.0.1:50001
  → 250-ServiceID=<56 chars>   250-PrivateKey=ED25519-V3:<base64>   250 OK
ADD_ONION ED25519-V3:<stored key> Flags=Detach PoWDefensesEnabled=1 Port=50001,127.0.0.1:50001
DEL_ONION <ServiceID>
```

Rules:

- One service per application and purpose: Bitcoin Core's own documentation recommends not adding other ports to its onion service because "it is trivial to link them" ([tor.md §4](https://github.com/bitcoin/bitcoin/blob/v31.1/doc/tor.md)).
- Bitcoin Core manages its own P2P onion service through the control port (`listenonion`); BTCortex must not create a second one for the same node.
- **Never** create an onion service for Bitcoin Core RPC by default. If the user wants remote management over Tor, require client authorisation plus a restricted `rpcauth` user.
- Use client authorisation ("restricted discovery" in the specification) for private services such as a personal Electrum server; anyone who knows an unrestricted address can connect. Revocation needs a restart or SIGHUP for file-based services.
- `HiddenServiceAllowUnknownPorts` default 0 now really closes circuits for unknown ports again (fixed in 0.4.9.14).
- Health: after creation wait for `650 HS_DESC UPLOADED <addr> …` events (failures arrive as `HS_DESC FAILED … REASON=UPLOAD_REJECTED` etc.); then optionally self-test by connecting through the SocksPort to `<addr>.onion:<port>`. Display the address with a copy button and QR code, and show it only to the user.
- Back up keys (encrypted) with BTCortex's configuration backups: losing the key changes the address that remote wallets were configured with.

### 2.14 Start and stop on Windows

- **No POSIX signals.** tor registers a console control handler that turns any console control event (Ctrl+C, Ctrl+Break, close) into SIGINT ([main.c](https://gitlab.torproject.org/tpo/core/tor/-/blob/tor-0.4.9.14/src/app/main/main.c)); for a client (not a relay) SIGINT means "Interrupt: exiting cleanly". Sending console events to a windowless child is fragile, so use the control port.
- **Graceful stop:** stop dependent services first (Bitcoin Core, Electrum servers, wallets), then `SIGNAL SHUTDOWN` — "Controlled shutdown: if server is an OP, exit immediately. If it's an OR, close listeners and exit after ShutdownWaitLength seconds" ([SIGNAL](https://spec.torproject.org/control-spec/commands.html)). A BTCortex tor is a client with onion services, so it exits at once. Wait for the process to exit (for example 10 s), then `SIGNAL HALT`, then `TerminateProcess` as the last resort.
- **Crash safety:** Job Object kill-on-close, `__OwningControllerProcess` (15 s polling) and optionally `TAKEOWNERSHIP` (tor exits when the owning connection closes; "Tor does not wait a while for circuits to close", so still send `SIGNAL SHUTDOWN` for normal stops).
- **Restart policy:** exponential back-off; after three failures within ten minutes show the last 50 notice lines and the most likely cause (§2.18).
- **Reload:** `SIGNAL RELOAD` (HUP equivalent) re-reads the torrc; BTCortex can also use `SETCONF` for runtime changes, but regenerating the file and reloading keeps a single source of truth.

### 2.15 Pluggable transports and bridges

- Transports in the bundle: `lyrebird.exe` (obfs4, WebTunnel, meek_lite, Snowflake, legacy obfs2/obfs3/ScrambleSuit) and `conjure-client.exe` (experimental). Yawning Angel's obfs4proxy (last tag 0.0.14, 2022-09-04) is superseded by lyrebird; imported torrc files that reference `obfs4proxy.exe` must be rewritten (entry `obfs4proxy`).
- Configuration (working directory = bundle root): `UseBridges 1`, the `ClientTransportPlugin` lines from §2.8 (taken from the installed `pt_config.json`, with `${pt_path}` replaced by `tor\pluggable_transports\`), and one `Bridge <transport> <ip:port> <fingerprint> <args>` line per bridge. "If 'transport' is provided, it must match a ClientTransportPlugin line" ([manual](https://gitlab.torproject.org/tpo/core/tor/-/raw/tor-0.4.9.14/doc/man/tor.1.txt)).
- Built-in bridges: read them from the installed `pt_config.json` (1 meek, 7 obfs4, 2 Snowflake in 15.0.25) instead of hard-coding them, because they change between releases. WebTunnel has no built-in bridges; users obtain bridges from [bridges.torproject.org](https://bridges.torproject.org/), which also mentions "email, telegram, and within the Tor browser" as channels.
- Bridges hide Tor use from the local network; they add no anonymity. Snowflake and meek depend on CDNs and domain fronts named in the bridge lines.
- Upstream proxies (corporate networks): tor supports `HTTPSProxy`, `Socks4Proxy`, `Socks5Proxy` and `TCPProxy` (manual); Bootstrap phases 3–4 then report the proxy connection.

### 2.16 Detecting existing Tor installations (external Tor detection)

| Signal | Meaning |
|---|---|
| Listener on 127.0.0.1:9050/9051 | A standalone or system tor (or another application) |
| Listener on 9150/9151 | Tor Browser running (defaults in tor-launcher: SOCKS 9150 in [TorLauncherUtil](https://gitlab.torproject.org/tpo/applications/tor-browser/-/blob/tor-browser-140.7.0esr-15.0-1/toolkit/components/tor-launcher/TorLauncherUtil.sys.mjs), `extensions.torlauncher.control_port` 9151 in [000-tor-browser.js](https://gitlab.torproject.org/tpo/applications/tor-browser/-/blob/tor-browser-140.7.0esr-15.0-1/browser/app/profile/000-tor-browser.js)) |
| Listener on 37150/37151 (37152/37153) | Wasabi's bundled tor ([TorSettings.cs](https://github.com/WalletWasabi/WalletWasabi/blob/v2.8.4/WalletWasabi/Tor/TorSettings.cs)) |
| Service `tor` ("Tor Win32 Service") | Someone used `tor --service install` |
| `tor.exe` processes and their image paths | Identify owner applications (Sparrow's internal Tor, Specter's `tor-binaries`, Tor Browser) |

Probing rule: on a suspected control port send only `PROTOCOLINFO 1` (allowed before authentication) to learn the version and authentication methods, then `QUIT`; never read other applications' cookie files and never send traffic through someone else's SOCKS port without the user's choice. Map listening ports to processes with `GetExtendedTcpTable` (no administrator rights needed for the user's own processes; not verified for all cases).

### 2.17 Per-application proxy policies, stream isolation and DNS leaks

- **Separate SocksPorts per application class** (node, Electrum server, wallets, explorers): streams from different listeners never share circuits by default, and warnings can be attributed. Within one port, different SOCKS5 usernames give different circuits (`IsolateSOCKSAuth`, RFC 1929 credentials reinterpreted by [Tor's SOCKS extensions](https://spec.torproject.org/socks-extensions.html)); Bitcoin Core's `proxyrandomize` (default 1) uses this.
- **DNS:** applications must hand hostnames to the proxy (SOCKS5 with remote resolution, "socks5h"). Bitcoin Core: "The proxy for DNS requests is taken from -proxy=addr:port or -proxy=addr:port=ipv4 or -proxy=addr:port=ipv6 … It is not taken from -proxy=addr:port=tor or -onion=addr:port. If no proxy for DNS requests is configured, then they will be done using the functions provided by the operating system, most likely resulting in them being done over the clearnet to the DNS servers of the internet service provider" ([tor.md](https://github.com/bitcoin/bitcoin/blob/v31.1/doc/tor.md)). So a Tor-only Core profile uses the generic `proxy=127.0.0.1:9050`, not only `onion=`.
- Watch `DANGEROUS_SOCKS` on the wallet port as a leak indicator; Specter's `socks5h://` URL is correct, Electrum uses `socks5:host:port` (wallets scope).
- Never point system-wide DNS at tor and never route the whole machine through tor; BTCortex controls per-application settings only.
- Bitcoin P2P over Tor exits: Core's BIP 324 v2 transport (default on) encrypts P2P traffic opportunistically, but exit relays still see which IPv4/IPv6 peers are contacted.

### 2.18 Failure modes and diagnostics

| Symptom | Likely cause | Detection | Action |
|---|---|---|---|
| tor exits immediately | Port already in use; DataDirectory locked by another tor; non-ASCII path; invalid torrc | Exit code, stdout notices; `tor.exe --verify-config` | Pre-flight port check; one tor per DataDirectory (`lock` file); §2.9 |
| Bootstrap stuck at 5–15 % | Network blocks Tor, proxy required, firewall | `WARN BOOTSTRAP` with REASON, `RECOMMENDATION=warn` | Offer bridges (Snowflake, obfs4, WebTunnel) or upstream proxy |
| Stuck at 25–50 % | Clock wrong; slow link | `CLOCK_SKEW`; progress slow | Ask the user to synchronise time; wait |
| `515 Bad authentication` | Wrong cookie (tor restarted, cookie regenerated) or foreign tor on the port | SAFECOOKIE server-hash mismatch | Re-read cookie; if it still fails, the port belongs to someone else |
| No onion reachability | Descriptor upload failing, network down | `HS_DESC FAILED`, `NETWORK_LIVENESS DOWN` | Retry; check liveness |
| Version warning | Obsolete tor | `DANGEROUS_VERSION`, `status/version/current` | Update the bundle |
| Idle tor stops building circuits | Dormant mode | `GETINFO dormant` | `SIGNAL ACTIVE` |
| Executable blocked or deleted | Antivirus or application-control policy against unsigned binaries in user folders | Spawn error; missing file | Explain; offer re-verification and allow-listing guidance (not tested) |
| Bitcoin Core onion missing | Core not listening, cookie unreadable, wrong `torcontrol` | Core `debug=tor` log: "Authentication cookie … could not be opened" | Same Windows user for Core and tor; correct port |

### 2.19 Tor Browser vs the tor daemon

Tor Browser 15.0.25 (2026-10-12) bundles its own tor but must not be a dependency:

- Its tor exists only while the browser runs and is owned by it (`__OwningControllerProcess` with the browser's PID), so Bitcoin Core's onion service and any wallet connection would disappear when the user closes the browser.
- Ports 9150/9151 instead of 9050/9051; the control cookie lives in the browser's profile, which BTCortex must not read.
- Its configuration is written by the browser ("DO NOT EDIT … may be overwritten during the next Tor Browser update") and it updates itself, changing tor versions without notice.
- Sharing the browser's tor mixes application and browsing circuits.

BTCortex treats Tor Browser as an **external launcher** (open an onion block explorer URL for the user) and warns when an application is configured to use 9150.

### 2.20 Arti and the recommendation

- **Arti 2.7.0, 2026-10-01**, monthly releases ([CHANGELOG](https://gitlab.torproject.org/tpo/core/arti/-/blob/main/CHANGELOG.md)). README (status as of August 2026): "Arti is a full-featured Tor client … It can run and connect to onion services. We believe that Arti is suitable for general client usage"; "We expect to be providing official binaries soon. But, for now, you need to … build it yourself" ([README](https://gitlab.torproject.org/tpo/core/arti/-/blob/main/README.md)).
- Compatibility (February 2026): "Arti runs as a client, and supports running onion services and connecting to them. It supports using bridges and pluggable transports", and "Going forward, Arti is the preferred Tor client for new feature development" ([Compatibility.md](https://gitlab.torproject.org/tpo/core/arti/-/blob/main/doc/Compatibility.md)).
- But its onion-service document at tag `arti-v2.7.0` still says hosting is "**suitable for testing and experimentation only** … may even compromise the privacy of your other uses of the same Arti instance" ([OnionService.md](https://gitlab.torproject.org/tpo/core/arti/-/blob/arti-v2.7.0/doc/OnionService.md)); hosting needs the non-default `onion-service-service` feature; restricted discovery is still an experimental feature ([crate README](https://gitlab.torproject.org/tpo/core/arti/-/blob/main/crates/arti/README.md)).
- RPC: Arti's own RPC was declared stable in 1.4.2 (2025-03-31), but it is a different protocol; there is **no C-tor control port**, so Bitcoin Core's `torcontrol`/`ADD_ONION` integration cannot work with Arti.
- Windows is a "target" in the [support policy](https://gitlab.torproject.org/tpo/core/arti/-/blob/arti-v2.7.0/doc/SupportPolicy.md) with automated builds but no automated tests.

**Recommendation: C tor from the Tor Expert Bundle today.** Keep Arti as `research-only` and re-evaluate when official Windows binaries exist, onion-service hosting is declared production-ready and an RPC covers bootstrap status and onion-service management (or Bitcoin Core gains Arti support). Design the Tor adapter behind an interface (SOCKS endpoint, health, onion-service CRUD) so that Arti can be added later.

### 2.21 How Bitcoin Core, Electrum servers and wallets use Tor — and what each configuration means for privacy

| Component | Configuration written by BTCortex | Source |
|---|---|---|
| `bitcoin-core` outbound via Tor | `proxy=127.0.0.1:9050` (all networks through Tor, DNS through the proxy) or `onion=127.0.0.1:9050` (only .onion through Tor); `onlynet=onion` optionally (the alias `tor` was removed in 31.0) | [tor.md](https://github.com/bitcoin/bitcoin/blob/v31.1/doc/tor.md), `full-nodes-core` §6.2 |
| `bitcoin-core` inbound onion | `listen=1`, `listenonion=1`, `torcontrol=127.0.0.1:9051`, SAFECOOKIE via the cookie path from PROTOCOLINFO (same Windows user) or `torpassword`; Core binds `127.0.0.1:8334=onion` and creates an ephemeral v3 service with its key in `onion_v3_private_key`; 32.0 enables PoW defences. For onion-only inbound set `bind=127.0.0.1:8334=onion` explicitly so that nothing listens on 0.0.0.0 (also avoids the firewall prompt) | tor.md, [torcontrol.cpp](https://github.com/bitcoin/bitcoin/blob/v31.1/src/torcontrol.cpp) |
| `bitcoin-core` own transactions | `privatebroadcast=1` (31.0+, use 31.1 or later) sends `sendrawtransaction` broadcasts over short-lived Tor/I2P connections | `full-nodes-core` §6.2 |
| `fulcrum` | `peering = false`, `announce = false` for a private server (electrum scope); `tor_proxy = 127.0.0.1:9050` only if peering is wanted; inbound for remote wallets through an onion service mapping `50001 → 127.0.0.1:50001` (TLS optional over onion); `tor_hostname`/`tor_*_port` only matter for public announcement | [Fulcrum example config](https://github.com/cculianu/Fulcrum/blob/master/doc/fulcrum-example-config.conf) |
| `sparrow` | Local Fulcrum or Core over loopback needs no Tor; for remote or public servers `useProxy=true`, `proxyServer="127.0.0.1:9052"`; without a proxy Sparrow starts its internal Tor for .onion servers | wallets scope §3.9 |
| `electrum` | `proxy = socks5:127.0.0.1:9052` with `oneserver` and a pinned server | wallets scope |
| `specter-desktop` | `tor_type: "custom"`, `proxy_url: "socks5h://127.0.0.1:9052"` | wallets scope |
| `wasabi-wallet` | Uses its own bundled tor (37150/37151) | wallets scope |

Privacy implications:

| Configuration | Gains | Remaining exposure |
|---|---|---|
| Clearnet node, `listen=0` (BTCortex default) | Nothing hidden | ISP sees Bitcoin use; peers see the IP; own transactions originate from the IP unless `privatebroadcast` is used |
| `proxy=` Tor, mixed networks | Peers do not learn the IP | ISP sees Tor use; exits see which clearnet peers are contacted; slower IBD |
| `onlynet=onion` (optionally plus `i2p`) | No exits involved | Fewer peers and higher eclipse/Sybil risk; slow IBD — Core's i2p.md warns similarly for `onlynet=i2p` and suggests combining networks |
| Listening on clearnet and onion | Helps the network ("bridge nodes … increase the cost and complexity of launching eclipse and partition attacks") | "an adversary that can connect to your node on multiple networks may be able to correlate those identities" (tor.md §4) |
| Wallet → own Electrum server over loopback | No network exposure | None beyond the host |
| Wallet → own Electrum server over an onion service with client authorisation | Remote access without opening ports or revealing the home IP | The wallet device must run Tor |
| Wallet → public Electrum server over Tor | Server does not learn the IP | Server learns all wallet addresses (and links them) — not private |
| Any of the above over a VPN instead of Tor | ISP no longer sees destinations | The VPN provider sees everything; not anonymous |

---

## 3. I2P

### 3.1 i2pd (managed choice)

- **3.0.0, 2026-10-20** ([release](https://github.com/PurpleI2P/i2pd/releases/tag/3.0.0)): full SAM 3.3, I2PControl `LocalDestinationInfo`, "Create keys files readable by owner only", torrent tunnels and more. Windows assets: `i2pd_3.0.0_win64_mingw.zip` (4.9 MB), `_win32_mingw.zip`, `_winxp_mingw.zip`, `setup_i2pd_v3.0.0.exe`. **The 3.0.0 release had no `SHA512SUMS` or `SHA512SUMS.asc` on 2026-10-21**; 2.61.0 (2026-07-20) has both, signed by key `9519 28BB 3170 24EF D053 D73C 66F6 C87B 98EB CFE2` (keys.openpgp.org lists it as R4SAS; no fingerprint was found on i2pd's own pages). BTCortex should only install releases whose signed checksum file exists.
- Windows release builds are Win32 tray applications ([DaemonWin32.cpp](https://github.com/PurpleI2P/i2pd/blob/openssl/Win32/DaemonWin32.cpp)); errors appear as message boxes.
- Data directory ([FS.cpp](https://github.com/PurpleI2P/i2pd/blob/openssl/libi2pd/FS.cpp)): `--datadir` if given; otherwise the executable's folder if it contains `i2pd.conf` (portable mode); otherwise `%APPDATA%\i2pd`; with `--service`, `C:\ProgramData\i2pd`. `datadir` and `service` are command-line-only ([configuration](https://github.com/PurpleI2P/i2pd_docs_en/blob/master/docs/user-guide/configuration.md)). The source default for `daemon` is false ([Config.cpp](https://github.com/PurpleI2P/i2pd/blob/openssl/libi2pd/Config.cpp)), although the documentation table says true.
- Defaults that matter: SAM enabled (usually 127.0.0.1:7656), web console 7070, HTTP proxy 4444 and SOCKS proxy 4447 enabled, I2CP 7654 enabled, I2PControl 7650 disabled (password "itoopie"), transports on a random port, **UPnP "false by default for CLI and true for GUI (Windows, Android)"**.
- Recommended `i2pd.conf` for a BTCortex-managed router (option names from the documentation table; section syntax to be confirmed in testing):

```ini
# Managed by BTCortex
loglevel = warn
ipv4 = true
ipv6 = false
bandwidth = O          # 256 KB/s; transit sharing left on, as Bitcoin Core's i2p.md asks
[http]
enabled = true
address = 127.0.0.1
port = 7070
[httpproxy]
enabled = false
[socksproxy]
enabled = false
[sam]
enabled = true
address = 127.0.0.1
port = 7656
[i2pcontrol]
enabled = true
address = 127.0.0.1
port = 7650
password = <random, stored with DPAPI>
[upnp]
enabled = false
```

Launch: `i2pd.exe --datadir=<%LOCALAPPDATA%\BTCortex\i2pd> --conf=<…\i2pd.conf> --tunconf=<…\tunnels.conf>`. Health: SAM `HELLO VERSION MIN=3.1 MAX=3.1` on 7656 answered with `HELLO REPLY RESULT=OK`, and I2PControl `RouterInfo`. Stop: I2PControl `RouterManager` `Shutdown` (immediate) or `ShutdownGraceful` (on Linux "i2pd stops after finishing to route transit tunnels (maximum 10 minutes)").

### 3.2 Java I2P

- **2.13.0, announced 2026-07-20** (post-quantum NTCP2, SSU1 removed; [blog](https://i2p.net/en/blog/2026/07/20/i2p-2.13.0-release/)). geti2p.net now redirects to **i2p.net**. The GitHub mirror shows a tag `i2p-2.14.0` on 2026-10-20, but no 2.14.0 files or announcement existed on 2026-10-21.
- Windows: `i2pinstall_2.13.0_windows.exe` (needs Java) and `I2P-Windows-Easy-Install-Bundle.exe` (beta, bundles Java, about 171 MB). Signatures (`.sig`, key `70D2 0607 38BE F805 23AC AFF7 D75C 03B3 9B5E 14E1`, idk/eyedeekay; "Releases 0.9.57 forward are signed by idk") exist only for the `.jar`, the macOS `.dmg` and the source; the blog's SHA-256 list names `i2pinstall_2.13.0-0_windows.exe`, which does not match the download name, and omits the Easy-Install bundle ([downloads](https://i2p.net/en/downloads), [signing key](https://i2p.net/en/docs/development/release-signing-key/)).
- SAM is **off by default**; Core's i2p.md: start it in the console Clients page (`http://127.0.0.1:7657/configclients`) or in `clients.config`. I2PControl on `https://127.0.0.1:7650/`.
- Recommendation: **connected application** — detect a running router, check SAM, guide the user; do not install it unattended.

### 3.3 Bitcoin Core with I2P

From [doc/i2p.md](https://github.com/bitcoin/bitcoin/blob/v31.1/doc/i2p.md): `i2psam=127.0.0.1:7656`; `i2pacceptincoming=1` (default) creates a persistent I2P address whose key is saved as `i2p_private_key` in the data directory; with `i2pacceptincoming=0` Core uses "a random transient I2P address for itself on each outbound connection". "In the I2P network, the receiver of an inbound connection sees the address of the initiator. This is unlike the Tor network." Core speaks SAM 3.1, which has no ports, so it listens and advertises with port 0 and connects only to I2P addresses with port 0. `onlynet=i2p` alone risks Sybil attacks and slow IBD. Recommended BTCortex default when I2P is enabled: `i2pacceptincoming=0` for nodes with `listen=0`, combined with Tor.

The SAM v3 specification page says "i2pd does not currently support most 3.2 and 3.3 features" (updated 2026-07; [SAM V3](https://i2p.net/en/docs/api/samv3/)), while i2pd 3.0.0 announces full SAM 3.3 — irrelevant for Core, which needs 3.1.

---

## 4. CJDNS

- cjdns tags up to **cjdns-v22.3** (2025-12-10) ([repository](https://github.com/cjdelisle/cjdns)); maintenance-only.
- Windows: no binaries; [doc/install/windows.md](https://github.com/cjdelisle/cjdns/blob/master/doc/install/windows.md) (last changed 2017-01-18) says to cross-compile from Linux with mingw, install the OpenVPN TAP driver and "execute cjdns from an elevated command prompt", and to allow it through the Windows Firewall. The README covers only Linux and macOS.
- Bitcoin Core (23.0+): `cjdnsreachable=1` tells Core that `fc00::/8` addresses are CJDNS rather than RFC 4193 private IPv6; `onlynet=cjdns` optional ([cjdns.md](https://github.com/bitcoin/bitcoin/blob/v31.1/doc/cjdns.md)). It is encryption without anonymity.
- Recommendation: **research-only** on Windows; for remote Linux nodes that already run cjdns, BTCortex may set `cjdnsreachable` remotely.

---

## 5. Encrypted tunnels, private networks and remote access

| Tool | Latest | Windows | Admin needed | BTCortex role |
|---|---|---|---|---|
| `wireguard` | 1.1.1 (2026-09-20) | MSIs x64/arm64/x86; `latest.sig` (signify) over the MSI hashes | Yes (driver, services) | Generate configurations; install a tunnel service only with explicit UAC consent: `wireguard /installtunnelservice C:\path\btcortex.conf` → service `WireGuardTunnel$btcortex`; `wg show` for status ([enterprise.md](https://git.zx2c4.com/wireguard-windows/about/docs/enterprise.md)) |
| `tailscale` | 1.104.2 (2026-10-21) | MSI/EXE x64/arm64/x86 into `C:\Program Files\Tailscale`; Windows 10+ | Yes (per-machine) | Detect; `tailscale status --json`; `tailscale serve` for loopback web UIs only with consent; never Funnel |
| `headscale` | 0.29.5 (2026-10-13) | No server build (Linux/macOS/FreeBSD, containers) | n/a | Point Tailscale clients at a user-provided server (`tailscale login --login-server`) |
| `zerotier` | 1.16.2 (2026-05-28) | MSI with service and adapter | Yes | Detect; local API on port 9993 with `authtoken.secret` |
| `netbird` | 0.81.3 (2026-10-19) | MSI/EXE x64/arm64 | Yes (not verified) | Detect |
| `openssh` | In-box client (9.5p1 on the test machine); Win32-OpenSSH 10.4.0.0p1-Preview (2026-10-20) | Client present by default since Windows 10 1809 | Server: yes | Remote management and port forwarding (specification section 26) |
| `cloudflared`, `frp` | 2026.10.2; 0.71.1 | Yes | No (binary) | Detect and warn; not recommended |

Key points:

- **Tailscale privacy:** Funnel only on ports 443, 8443 and 10000; "Funnel relay servers do not decrypt the traffic"; anyone with the URL can access ([Funnel](https://tailscale.com/kb/1223/funnel)). Enabling HTTPS publishes `machine-name.tailnet-name.ts.net` in Certificate Transparency logs: "Do not enable the HTTPS feature if any of your machine names contain sensitive information" ([HTTPS](https://tailscale.com/kb/1153/enabling-https)). Serve is tailnet-only and adds identity headers, so "Your backend should listen only on localhost" ([Serve](https://tailscale.com/kb/1312/serve)). The Windows GUI wrapper is closed source ([README](https://github.com/tailscale/tailscale/blob/main/README.md)).
- **ZeroTier licence:** LICENSE.txt says MPL-2.0 for most code plus a source-available `nonfree/` directory, while the README still says BSL 1.1 ([LICENSE.txt](https://github.com/zerotier/ZeroTierOne/blob/main/LICENSE.txt), [README](https://github.com/zerotier/ZeroTierOne/blob/main/README.md)) — unresolved conflict.
- **SSH host keys (specification 21.2):** never `StrictHostKeyChecking=no`. Flow: fetch the host key, show its SHA-256 fingerprint, require confirmation or out-of-band comparison, store it in a BTCortex-managed `UserKnownHostsFile`, then always connect with `StrictHostKeyChecking=yes` (which "refuses to connect to hosts whose host key has changed") and `BatchMode=yes`; tunnels use `-N -L 127.0.0.1:<local>:127.0.0.1:<remote>` with `ExitOnForwardFailure=yes` ([ssh_config(5)](https://man.openbsd.org/ssh_config.5)). Possessing Bitcoin RPC credentials grants no SSH rights and vice versa (specification section 26).
- **Reverse tunnels:** prefer, in order: Tor onion services (no account, no inbound port, anonymity for both sides), a private network (Tailscale/WireGuard), SSH `-R` to a server the user controls; hosted public tunnels (Cloudflare Tunnel, frp, Funnel) only for web content the user deliberately publishes, never for RPC or management interfaces.

---

## 6. Reverse proxies, local TLS and Windows Firewall

### 6.1 Caddy (recommended)

- **2.11.7, 2026-10-03**; `caddy_2.11.7_windows_amd64.zip` (18.5 MB) and arm64 ([release](https://github.com/caddyserver/caddy/releases/tag/v2.11.7)). `caddy_2.11.7_checksums.txt` holds SHA-512 sums and is signed with Sigstore keyless signing: the `.pem` certificate's identity is `https://github.com/caddyserver/caddy/.github/workflows/release.yml@refs/tags/v2.11.7` (read from the certificate). BTCortex verifies the certificate chain and identity (for example with sigstore-js) and then the SHA-512.
- Local HTTPS: Caddy's internal CA ("Caddy Local Authority", Smallstep libraries, data in `pki/authorities/local`) issues certificates for `localhost`, IP addresses and names such as `.local`, `.internal`, `.home.arpa`; on first use it tries to install the root into the system trust store and may prompt; `skip_install_trust` disables that ([Automatic HTTPS](https://caddyserver.com/docs/automatic-https)).
- Admin API on `localhost:2019` (`POST /load`, `POST /stop`), unauthenticated by default ([API](https://caddyserver.com/docs/api)); BTCortex should disable or restrict it because any local process could otherwise reconfigure the proxy.
- As a Windows service only through `sc.exe create caddy start= auto binPath= "…\caddy.exe run"` or WinSW (administrator) ([running](https://caddyserver.com/docs/running)); BTCortex runs `caddy run` as a per-user child process instead.
- Use cases: TLS for LAN access to BTCortex-managed web UIs (explorers, BTCPay Server, Lightning UIs) with explicit consent. Electrum TLS is native in Fulcrum (electrum scope); onion services already provide end-to-end encryption.

### 6.2 nginx, mkcert, stunnel

- **nginx/Windows** 1.31.7 mainline / 1.30.6 stable (both 2026-10-14): "Only the select() and poll() (1.15.9) connection processing methods are currently used, so high performance and scalability should not be expected. Due to this and some other known issues version of nginx for Windows is considered to be a beta version"; only one worker does any work; no UDP/QUIC; console application, not a service ([nginx for Windows](https://nginx.org/en/docs/windows.html)). Research-only.
- **mkcert** 1.4.4 (2022-04-26) is stale; "the rootCA-key.pem file … gives complete power to intercept secure requests from your machine" ([README](https://github.com/FiloSottile/mkcert)). Prefer certificate pinning (Electrum `serverfingerprint`, Sparrow pinning) or Caddy's CA without trust-store installation.
- **stunnel** 5.82 (2026-09-17), Windows installer with `.asc` (signing subkey `2BC7 E4E6 7E3C C0C1 BEA7 2F8C 2EFC 7FF0 D416 E014` of Michał Trojnara's key `AC91 5EA3 0645 D9D3 D4DA E4FE B104 8932 DD3A AAA3`) ([downloads](https://www.stunnel.org/downloads.html)); only needed for TCP services without TLS such as electrs.

### 6.3 Windows Firewall rule management and consent

From [Windows Firewall rules](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/rules):

- When an application first listens without an allow rule, Windows prompts. "If the user has admin permissions, they're prompted. If they respond No or cancel the prompt, block rules are created." "**If the user isn't a local admin and they are prompted, block rules are created. It doesn't matter what option is selected.**" Once created, those rules "must be deleted to generate the prompt again".
- "The behaviors involved in the automatic creation of application rules at runtime require user interaction and administrative privilege"; rules must use full program paths (no wildcards).

Consequences for BTCortex (specification 21.1, "Do not open Windows Firewall ports automatically without clear permission"):

1. Bind every managed listener to `127.0.0.1` by default (tor SocksPort/ControlPort, Core RPC, `bind=127.0.0.1:8334=onion`, Fulcrum, Frigate `tcp`, Caddy, i2pd SAM/console). That loopback-only listeners do not trigger the prompt is expected but **must be tested** on the target machines.
2. Prefer designs that need no inbound port: Tor onion services and outbound-only private networks.
3. When the user explicitly enables LAN or inbound access, show the exact rule and request a UAC elevation for that change only, scoped to program path, port, protocol, profile (Private) and remote address (LocalSubnet), and tagged with a group for clean removal, for example `New-NetFirewallRule -DisplayName "BTCortex Fulcrum (LAN)" -Group "BTCortex" -Direction Inbound -Program <full path> -Protocol TCP -LocalPort 50002 -Profile Private -RemoteAddress LocalSubnet -Action Allow` or the `netsh advfirewall firewall add rule` equivalent. Record it for removal.
4. i2pd's transport listener (random port, all interfaces) will raise the prompt; for a standard user that produces block rules, after which I2P still works outbound with reduced reachability. Explain this before starting i2pd.

---

## 7. Transaction privacy

### 7.1 Payjoin

- **Standards:** BIP 78 "A Simple Payjoin Proposal" — **Deployed**; BIP 77 "Async Payjoin" — **Draft**, version 0.2.0 (requires BIPs 21, 78, 173, 174); BIP 79 Bustapay — Closed, replaced by 78 ([bips](https://github.com/bitcoin/bips/blob/master/bip-0077.md)). BIP 77 uses a Payjoin Directory plus Oblivious HTTP relays (RFC 9458) so that sender and receiver need not be online together and no one runs a public server.
- **Payjoin Dev Kit** ([rust-payjoin](https://github.com/payjoin/rust-payjoin)): `payjoin` 1.2.0 (2026-10-02), `payjoin-ffi` 0.25.0 (2026-10-16) with Python, JavaScript, Dart and C# packages (2026-10-05); "This crate has not been reviewed by independent Rust and Bitcoin security professionals (yet)". `payjoin-mailroom` 0.1.3 combines an OHTTP relay and a BIP 77 directory.
- **payjoin-cli 1.0.0** (2026-10-05): reference CLI on a Bitcoin Core wallet (Core ≥ 29.0), v2 by default; "alpha-quality experimental software"; `cargo install` only; example config uses `rpcuser`/`rpcpassword`, directories `https://payjo.in` and `https://lets.payjo.in` and third-party OHTTP relays ([README](https://github.com/payjoin/rust-payjoin/blob/master/payjoin-cli/README.md)).
- **Wallet support** (secondary source, [Bitcoin Wiki](https://en.bitcoin.it/wiki/PayJoin_adoption), edited 2026-04-20): BTCPay Server send and receive (BIP 78), Cake Wallet v1 and v2 via PDK, Sparrow and Wasabi send, BlueWallet send.
- **BTCortex level:** research-only for the tools; in wallet integration, show whether the configured wallet supports Payjoin and pass BIP 21 URIs through untouched. BTCortex must not run directories or relays for others.

### 7.2 CoinJoin

| Project | Status (2026-10-21) | Coordinator model | BTCortex level |
|---|---|---|---|
| `joinmarket` (joinmarket-clientserver) | **Discontinued**: final release 0.9.12 (2026-04-27), repository archived the same day; "Do not continue to use the code without having independent confidence that it is not exploitable" ([release](https://github.com/JoinMarket-Org/joinmarket-clientserver/releases/tag/v0.9.12)) | None (market of makers and takers) | Unsupported; detect and point to migration |
| `joinmarket-ng` | Active, 0.42.1 (2026-10-20), MIT, wire-compatible, audit ongoing; Linux/macOS installer, Windows manual install only; Bitcoin Core or Neutrino back end; Tor cookie auth on 9051 ([README](https://github.com/joinmarket-ng/joinmarket-ng), [install](https://joinmarket-ng.github.io/joinmarket-ng/install/)) | None | Research-only |
| `jam` | v2.0.0-beta.4 (2026-09-30) requires joinmarket-ng ≥ 0.40.0, "Support for joinmarket-clientserver has been removed"; last stable 0.4.1 (2025-08-22); node-platform packages only | — | Research-only |
| `wasabi-wallet` + `wabisabi-coordinator` | Client active (2.8.4, 2026-10-13); coordinator software in the repository (`WalletWasabi.Coordinator`); zkSNACKs' coordinator closed 2024-06-01; `CoordinatorUri` empty by default; third-party coordinators | Central coordinator chosen by the user | Coordinator: unsupported (never operate or choose one) |
| `samourai-whirlpool` | Discontinued: coordinator and back-end servers seized on 2024-04-24; founders sentenced November 2025 ([NoBS](https://nobsbitcoin.com/how-to-recover-samourai-wallet-and-implications-for-different-types-of-users)); Ashigaru announced an independent coordinator on 2025-06-23 ([Ashigaru news](https://ashigaru.rs/news/)) | Central | Unsupported; migration guidance (see `whirlpool-gui`, `ashigaru-terminal`) |
| `joinstr` | Active (2026-10-13); Nostr relays coordinate; Electrum plugin, joinstrd REST, Umbrel, Sparrow build, Android ([website](https://joinstr.xyz/)) | Nostr relays | Research-only |

Legal status, stated neutrally: operating a CoinJoin coordinator has led to prosecution in the United States (Samourai) and to the voluntary shutdown of zkSNACKs' coordinator citing the need for legal certainty; treatment varies by jurisdiction. BTCortex therefore never operates or selects a coordinator, never installs CoinJoin software by default, and leaves the decision and configuration to the user.

### 7.3 Silent payments

- **BIP 352** Silent Payments — **Complete** (v1.1.1); BIP 374 DLEQ proofs, BIP 375 sending with PSBTs and BIP 392 `sp()` descriptors — all **Draft** ([bips](https://github.com/bitcoin/bips/blob/master/bip-0352.mediawiki)).
- Receiving requires examining every Taproot transaction with its spent outputs, so indexers need an **unpruned** node:
  - **`frigate` 1.6.1** (2026-10-05, Apache-2.0, Craig Raw): Electrum server with server-side scanning using ephemeral client keys, DuckDB, optional GPU; Windows `frigate-1.6.1-win-x86_64.zip`, manifest signed by `D4D0 D320 2FC0 6849 A257 B38D E946 1833 4C67 4B40`; needs Bitcoin Core 28+ with **`txindex=1`**, ~18 GB disk, ~4 GB RAM for the default cache and 8–16 GB RAM overall; occupies 50001/50002 and can forward ordinary requests to a co-located Fulcrum on another port; default listener is `tcp://0.0.0.0:50001`, so BTCortex must set `127.0.0.1` ([README](https://github.com/sparrowwallet/frigate)).
  - **`blindbit-oracle`**: Go tweak server for light clients; v2 rewrite on master needs Core ≥ 30 REST (`/rest/spenttxouts`) and an unpruned node; only tagged release v0.1.0 (2024-10-20); no Windows binaries ([README](https://github.com/setavenger/blindbit-oracle)).
  - Cake Wallet's esplora fork is listed by the [BIP352 index-server specification](https://github.com/silent-payments/BIP0352-index-server-specification) (work in progress) as a third implementation; it has no releases and was not researched further.
- Privacy: a remote scanner (Frigate) receives the scan private key; a tweak server (BlindBit) does not. BTCortex should connect wallets only to the user's own Frigate.
- On the test machine (pruned, 5.9 GB RAM) silent-payment indexing is impossible; the catalogue must show the requirement instead of an install button.

---

## 8. Recommended support levels

| Entry | Level | Priority | Rationale |
|---|---|---|---|
| `tor` | **fully-managed** | **P1** | Official signed portable archive, no admin rights, full control protocol; core of the privacy features |
| `lyrebird` | fully-managed | P2 | Ships with tor; configuration only |
| `tor-browser` | external-launcher | P2 | Useful for onion URLs; must not be a dependency |
| `arti` | research-only | P3 | No binaries, no control port, hosting experimental |
| `conjure` | research-only | P3 | Upstream calls it experimental and capacity-limited |
| `obfs4proxy` | unsupported | P3 | Superseded by lyrebird |
| `i2pd` | fully-managed | P2 | Portable signed ZIP (when checksums are published), SAM on by default |
| `i2p` | connected-application | P3 | Java, installer, weak Windows verification |
| `cjdns` | research-only | P3 | No Windows binaries; TAP driver and elevation |
| `wireguard`, `tailscale`, `zerotier`, `netbird` | connected-application | P2/P2/P3/P3 | Need administrator rights; detect and use existing installations |
| `headscale` | research-only | P3 | Linux server software |
| `openssh` | remote-managed | P2 | In-box client; basis of remote management |
| `cloudflared`, `frp` | research-only | P3 | Third-party public endpoints; conflict with privacy defaults |
| `caddy` | fully-managed | P2 | Portable, signed checksums, internal CA |
| `nginx`, `mkcert`, `stunnel` | research-only | P3 | Beta on Windows; stale; niche |
| `payjoin-cli`, `payjoin-dev-kit`, `payjoin-mailroom` | research-only | P3 | Alpha CLI, library, infrastructure |
| `joinmarket` | unsupported | P3 | Archived with an explicit warning |
| `joinmarket-ng`, `jam`, `joinstr` | research-only | P3 | Young or beta; CoinJoin decisions belong to the user |
| `wabisabi-coordinator`, `samourai-whirlpool` | unsupported | P3 | BTCortex never operates coordinators; Whirlpool seized |
| `frigate` | fully-managed (gated) | P3 | Native signed build; needs unpruned node with `txindex`, ≥ 8 GB RAM |
| `blindbit-oracle` | research-only | P3 | No releases of current code, no binaries |

---

## 9. Windows-specific pitfalls

1. **torrc parsing:** trailing backslash continues the line; escapes only inside quotes; multi-token values with spaces break. Pass paths as command-line arguments and use working-directory-relative transport paths (§2.9).
2. **Non-ASCII profile paths** stop tor from starting (issue #10416 open).
3. **No Unix sockets** for tor's ControlSocket/SocksPort on Windows; everything is TCP on loopback, so authentication (SAFECOOKIE) is mandatory.
4. **No POSIX signals:** use `SIGNAL SHUTDOWN`; console events map to SIGINT only for console processes.
5. **Service mode needs administrator rights** (tor, WireGuard, Tailscale, ZeroTier, sshd, Caddy as a service); per-user child processes are the zero-touch path.
6. **Unsigned executables:** tor.exe (and presumably lyrebird.exe and conjure-client.exe) have no Authenticode signature; downloads by BTCortex's own client carry no Mark of the Web, but antivirus or application-control policies may still block them (not tested).
7. **Port collisions:** 9050/9051 (system tor), 9150/9151 (Tor Browser), 37150/37151 (Wasabi), 50001/50002 (Fulcrum vs Frigate), 7656 (two I2P routers).
8. **Windows Firewall prompts:** standard users always get block rules; bind to loopback and avoid inbound designs.
9. **i2pd GUI build enables UPnP by default** and runs as a tray application.
10. **Sleep and clock:** after resume tor reports `CLOCK_JUMPED` and rebuilds circuits; a wrong clock stalls bootstrap (`CLOCK_SKEW`).
11. **VPN clients:** the test machine has Mullvad VPN installed (its folder is on PATH); kill-switch or lockdown modes of VPN clients may block tor's or bitcoind's outbound connections or LAN access. Not tested.
12. **Roaming profiles:** tor's default DataDirectory is the roaming Application Data folder; always use `%LOCALAPPDATA%`.
13. **Path length:** keep runtime paths short; long-path behaviour of tor on Windows was not tested.

---

## 10. Security and privacy considerations

- **Supply chain:** pin primary fingerprints (Tor Browser Developers `EF6E…8290`; i2pd R4SAS `9519…CFE2`; Frigate/Sparrow `D4D0…4B40`; stunnel `AC91…AAA3`; I2P idk `70D2…14E1`), refresh subkeys only under a pinned primary, verify checksums and signatures before extraction, validate archive paths, refuse downgrades, and record verification reports. Caddy uses Sigstore identities instead of OpenPGP.
- **Control surfaces are credentials:** tor ControlPort (full control, onion keys), I2PControl, Caddy admin API, ZeroTier local API, Tailscale LocalAPI — loopback only, authenticated, never proxied by Caddy or exposed through tunnels.
- **Onion keys are identities:** encrypt at rest (DPAPI), back up encrypted, rotate only with user consent (rotation breaks remote wallet configurations).
- **Isolation:** separate SocksPorts per application class; never route other users' or the whole system's traffic.
- **Logs:** tor at notice with `SafeLogging 1`; redact onion addresses of private services, cookies, passwords and bridge lines in BTCortex's logs and diagnostics exports.
- **Honest labelling:** anonymity network vs encrypted tunnel vs private network vs public endpoint (§1); "Tor-only" nodes have smaller peer sets; CoinJoin "does not guarantee anonymity" (JoinMarket NG README).
- **Privacy-affecting changes need confirmation** (specification 21.3): enabling listening, creating an onion service, exposing a service to a LAN or tailnet, switching to public Electrum servers, enabling UPnP.
- **Coordinators:** BTCortex never operates or chooses CoinJoin coordinators and never ships one.

---

## 11. Contradictions with the specification's assumptions

1. **"Tor service lifecycle management" (section 10)** cannot mean a Windows service under the zero-touch, no-administrator rule: tor's only service mode needs administrator rights, runs as LocalService with a single fixed name and puts the cookie where the user's processes cannot read it. BTCortex manages tor as a supervised per-user process.
2. **CJDNS "where relevant" (10.1)** is not deployable natively on Windows (no binaries, outdated cross-compile instructions, TAP driver, elevation).
3. **Zero-touch without administrator rights** is impossible for WireGuard, Tailscale, ZeroTier, NetBird and the OpenSSH server; BTCortex can only use existing installations or ask for one elevation per change.
4. **JoinMarket (16.2)**: the original implementation is archived (2026-04-27) and its Jam UI has moved to JoinMarket NG betas.
5. **Payjoin (16.2)**: BIP 77 is still Draft and the reference CLI is alpha without Windows binaries.
6. **Silent-payment indexing** needs an unpruned node with `txindex` (Frigate) or Core ≥ 30 REST on an unpruned node (BlindBit), which the pruned zero-touch profile on the test machine rules out.
7. **"Tor installation where verified"**: verification is possible (OpenPGP) but there is no Authenticode signature; antivirus and application-control interactions must be tested.
8. Bitcoin Core's documentation still links geti2p.net; the I2P project now lives at **i2p.net**.

---

## 12. Open questions

1. Which mitigation makes tor start reliably from a non-ASCII user profile (8.3 short paths, alternative base directory)? Needs a test account.
2. Do loopback-only listeners avoid the Windows Firewall prompt on Windows 10 22H2 and Windows 11? Needs testing for tor, i2pd, Fulcrum and Caddy.
3. Should BTCortex additionally verify the builder signatures on `sha256sums-unsigned-build.txt` (ma1, pierov) for 2-of-N assurance?
4. Should bridges be fetched in-app (Tor Browser's Moat mechanism was not researched) or only pasted by the user?
5. Will i2pd 3.0.0 receive `SHA512SUMS(.asc)`? Until then install 2.61.0 or wait.
6. Does Arti's RPC (stable since 1.4.2) expose bootstrap status and onion-service management well enough to replace the control port later?
7. Which wallets used with BTCortex support onion client authorisation (restricted discovery) for private Electrum servers?
8. How does Frigate start on Windows (launcher, bundled runtime), and can it run with a reduced cache on 8 GB machines?
9. Interaction of VPN clients such as the Mullvad VPN found on the test machine with tor, i2pd and Bitcoin Core.
10. Whether to pin `DormantCanceledByStartup` behaviour for BTCortex started at login (default kept).

---

## 13. Sources (all accessed 2026-10-21)

Tor: [download page](https://download.torproject.org/tor/) · [dist 15.0.25](https://dist.torproject.org/torbrowser/15.0.25/) · [archive](https://archive.torproject.org/tor-package-archive/torbrowser/) · [downloads.json](https://aus1.torproject.org/torbrowser/update_3/release/downloads.json) · [signature verification](https://support.torproject.org/tbb/how-to-verify-signature/) · [little-t-tor verification](https://support.torproject.org/little-t-tor/verify-little-t-tor/) · [key on keys.openpgp.org](https://keys.openpgp.org/vks/v1/by-fingerprint/EF6E286DDA85EA2A4BA7DE684E2C6E8793298290) · [WKD](https://openpgpkey.torproject.org/.well-known/openpgpkey/torproject.org/hu/kounek7zrdx745qydx6p59t9mqjpuhdf) · [ChangeLog 0.4.9.14](https://gitlab.torproject.org/tpo/core/tor/-/raw/tor-0.4.9.14/ChangeLog) · [CoreTorReleases](https://gitlab.torproject.org/tpo/core/team/-/wikis/NetworkTeam/CoreTorReleases) · [tor manual](https://gitlab.torproject.org/tpo/core/tor/-/raw/tor-0.4.9.14/doc/man/tor.1.txt) · [ntmain.c](https://gitlab.torproject.org/tpo/core/tor/-/blob/tor-0.4.9.14/src/app/main/ntmain.c) · [main.c](https://gitlab.torproject.org/tpo/core/tor/-/blob/tor-0.4.9.14/src/app/main/main.c) · [hs_service.c](https://gitlab.torproject.org/tpo/core/tor/-/blob/tor-0.4.9.14/src/feature/hs/hs_service.c) · [issue #10416](https://gitlab.torproject.org/tpo/core/tor/-/issues/10416) · [MR !357](https://gitlab.torproject.org/tpo/core/tor/-/merge_requests/357) · [control-spec](https://spec.torproject.org/control-spec/) · [rend-spec](https://spec.torproject.org/rend-spec/) · [hspow-spec](https://spec.torproject.org/hspow-spec/) · [socks-extensions](https://spec.torproject.org/socks-extensions.html) · [pt-spec](https://spec.torproject.org/pt-spec/) · [Tor Browser 15.0.25](https://blog.torproject.org/new-release-tor-browser-15025/) · [Tor Browser 15.0](https://blog.torproject.org/new-release-tor-browser-150/) · [legacy OS](https://support.torproject.org/tor-browser/security/legacy-os) · [TorProcess.sys.mjs](https://gitlab.torproject.org/tpo/applications/tor-browser/-/blob/tor-browser-140.7.0esr-15.0-1/toolkit/components/tor-launcher/TorProcess.sys.mjs) · [lyrebird](https://gitlab.torproject.org/tpo/anti-censorship/pluggable-transports/lyrebird) · [Conjure](https://gitlab.torproject.org/tpo/anti-censorship/pluggable-transports/conjure) · [obfs4](https://gitlab.com/yawning/obfs4) · [bridges](https://bridges.torproject.org/)

Arti: [README](https://gitlab.torproject.org/tpo/core/arti/-/blob/main/README.md) · [CHANGELOG](https://gitlab.torproject.org/tpo/core/arti/-/blob/main/CHANGELOG.md) · [Compatibility](https://gitlab.torproject.org/tpo/core/arti/-/blob/main/doc/Compatibility.md) · [OnionService](https://gitlab.torproject.org/tpo/core/arti/-/blob/arti-v2.7.0/doc/OnionService.md) · [SupportPolicy](https://gitlab.torproject.org/tpo/core/arti/-/blob/arti-v2.7.0/doc/SupportPolicy.md) · [capability limitations](https://arti.torproject.org/guides/capability-limitations)

Bitcoin Core and others: [tor.md](https://github.com/bitcoin/bitcoin/blob/v31.1/doc/tor.md) · [i2p.md](https://github.com/bitcoin/bitcoin/blob/v31.1/doc/i2p.md) · [cjdns.md](https://github.com/bitcoin/bitcoin/blob/v31.1/doc/cjdns.md) · [torcontrol.cpp](https://github.com/bitcoin/bitcoin/blob/v31.1/src/torcontrol.cpp) · [Fulcrum example config](https://github.com/cculianu/Fulcrum/blob/master/doc/fulcrum-example-config.conf) · [Wasabi TorSettings.cs](https://github.com/WalletWasabi/WalletWasabi/blob/v2.8.4/WalletWasabi/Tor/TorSettings.cs)

I2P and CJDNS: [i2pd 3.0.0](https://github.com/PurpleI2P/i2pd/releases/tag/3.0.0) · [i2pd 2.61.0](https://github.com/PurpleI2P/i2pd/releases/tag/2.61.0) · [i2pd configuration](https://github.com/PurpleI2P/i2pd_docs_en/blob/master/docs/user-guide/configuration.md) · [i2pd install](https://github.com/PurpleI2P/i2pd_docs_en/blob/master/docs/user-guide/install.md) · [i2pd I2PControl](https://github.com/PurpleI2P/i2pd_docs_en/blob/master/docs/devs/api/I2PControl.md) · [I2P downloads](https://i2p.net/en/downloads) · [I2P 2.13.0](https://i2p.net/en/blog/2026/07/20/i2p-2.13.0-release/) · [SAM V3](https://i2p.net/en/docs/api/samv3/) · [I2PControl](https://i2p.net/en/docs/api/i2pcontrol/) · [cjdns](https://github.com/cjdelisle/cjdns)

Tunnels and remote access: [WireGuard downloads](https://download.wireguard.com/windows-client/) · [enterprise.md](https://git.zx2c4.com/wireguard-windows/about/docs/enterprise.md) · [Tailscale packages](https://pkgs.tailscale.com/stable/) · [Funnel](https://tailscale.com/kb/1223/funnel) · [Serve](https://tailscale.com/kb/1312/serve) · [HTTPS](https://tailscale.com/kb/1153/enabling-https) · [MSI](https://tailscale.com/kb/1189/install-windows-msi) · [Headscale Windows](https://headscale.net/stable/usage/connect/windows/) · [ZeroTier service API](https://github.com/zerotier/ZeroTierOne/blob/main/service/README.md) · [NetBird v0.81.3](https://github.com/netbirdio/netbird/releases/tag/v0.81.3) · [OpenSSH on Windows](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_install_firstuse) · [Win32-OpenSSH releases](https://github.com/PowerShell/Win32-OpenSSH/releases) · [ssh_config(5)](https://man.openbsd.org/ssh_config.5) · [cloudflared 2026.10.2](https://github.com/cloudflare/cloudflared/releases/tag/2026.10.2) · [frp v0.71.1](https://github.com/fatedier/frp/releases/tag/v0.71.1) · [service access rights](https://learn.microsoft.com/en-us/windows/win32/services/service-security-and-access-rights) · [Windows Firewall rules](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/rules)

Proxies: [Caddy v2.11.7](https://github.com/caddyserver/caddy/releases/tag/v2.11.7) · [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https) · [Caddy API](https://caddyserver.com/docs/api) · [nginx for Windows](https://nginx.org/en/docs/windows.html) · [mkcert](https://github.com/FiloSottile/mkcert) · [stunnel downloads](https://www.stunnel.org/downloads.html)

Transaction privacy: [BIP 77](https://github.com/bitcoin/bips/blob/master/bip-0077.md) · [BIP 78](https://github.com/bitcoin/bips/blob/master/bip-0078.mediawiki) · [BIP 352](https://github.com/bitcoin/bips/blob/master/bip-0352.mediawiki) · [rust-payjoin](https://github.com/payjoin/rust-payjoin) · [payjoin-cli](https://github.com/payjoin/rust-payjoin/blob/master/payjoin-cli/README.md) · [PayJoin adoption](https://en.bitcoin.it/wiki/PayJoin_adoption) · [JoinMarket 0.9.12](https://github.com/JoinMarket-Org/joinmarket-clientserver/releases/tag/v0.9.12) · [JoinMarket NG](https://github.com/joinmarket-ng/joinmarket-ng) · [Jam](https://github.com/joinmarket-webui/jam) · [Wasabi CoinJoin docs](https://github.com/WalletWasabi/WasabiDoc/blob/master/docs/using-wasabi/CoinJoin.md) · [NoBS on Samourai](https://nobsbitcoin.com/how-to-recover-samourai-wallet-and-implications-for-different-types-of-users) · [Joinstr](https://joinstr.xyz/) · [Frigate](https://github.com/sparrowwallet/frigate) · [BlindBit Oracle](https://github.com/setavenger/blindbit-oracle) · [BIP352 index server spec](https://github.com/silent-payments/BIP0352-index-server-specification)
