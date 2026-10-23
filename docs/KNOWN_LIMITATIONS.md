# Known limitations

Current, honest limits of BTCortex. Each is either a deliberate trade-off or remaining work.

## Product scope today

- Bitcoin Core, Bitcoin Knots, Sparrow, Electrum, Tor, Fulcrum, hardware wallets (through HWI and Trezor Suite, and by PSBT files and QR codes for devices without a cable), LND and BTCPay Server (connection only), and mempool and Esplora explorers on other computers (connection only) are integrated. Other wallets, other Lightning implementations and the other researched components are not integrated yet; see [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md).
- The Installed software page covers Bitcoin Core, Sparrow, Tor and HWI; the update centre also covers Fulcrum and Electrum. Moving a node to an older Bitcoin Core is not offered; versions installed before file hashes were recorded cannot have their files checked until they are installed again.
- The catalogue shows every researched entry, but only these have service adapters: Bitcoin Core, Bitcoin Knots, Sparrow, Electrum, Fulcrum, LND, BTCPay Server, mempool and Esplora explorers, Tor, HWI, Trezor Suite, and the signing devices Trezor, Ledger, BitBox02, COLDCARD, Jade, KeepKey, Passport, Keystone, SeedSigner and Krux. The others are research only, whatever their target level. Dependencies are checked against what BTCortex knows is on this computer, which today means those; installing or updating from the catalogue page itself, version checks against requirements, port conflicts and disk checks for entries without an adapter are not built yet. The research behind each entry is dated, and the catalogue does not fetch newer releases by itself.
- Bitcoin Core already on this computer is found and connected with one click; a node on another computer is connected with its RPC address, user name and password (tested before it is saved; plain HTTP only on the local network). Cookie files of other computers cannot be used. BTCortex never starts, stops or reconfigures a node it did not set up.
- The charts on a node's own pages (mempool size, height, peers) keep 24 hours in memory and start again whenever BTCortex restarts. The monitoring page keeps each node's peers, mempool, traffic and progress in the database for as long as chosen there.
- The mempool page shows the node's own mempool only. Its fee-rate distribution needs `getmempoolfeeratediagram` (Bitcoin Core 31.0 and later); older nodes and Bitcoin Knots show statistics, policy and estimates without it. Fee estimates are Bitcoin Core's own and need the node to have seen enough blocks.
- Storage: folder sizes and the disk are measured only for nodes whose files are on this computer, and wallets only in the default wallets folder (a custom `walletdir` is not followed). Changes to indexes and pruning, rebuilds and deleting index files are offered only for nodes BTCortex set up; for other nodes the page is read-only apart from the verification of the latest blocks. Manual pruning (`prune=1` with `pruneblockchain`) is shown but not offered. The chain size used to check whether a full node fits is an estimate from Bitcoin Core 31.1's chain parameters.
- The mempool page does not measure transaction arrival rates; its trend shows the number of transactions waiting, which is arrivals minus confirmations, evictions and replacements. The developer tools' live events count arrivals while they watch a node that publishes ZMQ notifications.
- The replacement minimum covers the fee rules; whether a replacement also improves the mempool's fee-rate diagram (Bitcoin Core 31.0 and later) depends on the replacement itself and is only stated, not checked in advance.
- The RPC console takes arguments as typed text, as Bitcoin Core's own console does; typed forms per method and JSON-RPC batches are not built. It refuses methods that would pass private keys or wallet passphrases through BTCortex: use Bitcoin Core's own console, Sparrow or a hardware wallet for those.
- Peer connection history is kept in memory while BTCortex runs, sampled about once a minute; short connections between samples are not seen.
- The log centre searches the last 4 MiB of each log file; older lines are only in the files themselves (and in the diagnostic bundle, up to 5 MiB per file). bitcoind's exit codes are not recorded, because it runs detached from BTCortex.
- The configuration editor shows `bitcoin.conf` itself. Files added with `includeconf`, `settings.json` and command-line arguments other than those BTCortex passes are not shown, so the effective value it displays can differ from the running node's in those cases.

## Tor

- Tor is tested against the real tor with networking disabled, together with a real Bitcoin Core on regtest (cookie authentication, onion service, published onion address). A connection to the live Tor network was checked by hand on Windows 10 (connected in about two minutes) but is not part of the automated suite.
- Bridges and pluggable transports (obfs4, Snowflake, WebTunnel) are not offered yet, so networks that block Tor cannot be used; BTCortex says so when tor reports a blocked connection.
- tor cannot open folders whose names contain non-ASCII characters (Tor issue 10416). BTCortex then uses the folder's 8.3 short name; this fallback has not been tested on such a profile, and when Windows keeps no short name tor is not started.
- Only nodes BTCortex set up can be routed through Tor from the interface; other nodes are shown read-only. Wallets are not routed through Tor yet: Sparrow talks to the local node over loopback, which needs no Tor.
- BTCortex does not use another program's tor (Tor Browser, Wasabi, a separately installed tor) for the nodes; it only reports them.
- The onion service's key is kept by Bitcoin Core (`onion_v3_private_key` in the node's data directory), so the address stays the same across restarts; it is not yet part of BTCortex's backups.

## I2P

- BTCortex does not install or run an I2P router; it uses one the user runs. When this was decided (October 2026): the newest i2pd, 3.0.0 (20 October 2026), had no signed checksums (still none on 23 October 2026), and BTCortex installs only releases it can verify (2.61.0's SHA512SUMS and signature were checked and are valid, but it is the older release); i2pd's Windows release builds are tray applications rather than background programs; its I2P transport listener makes Windows Firewall ask a question, whose answer from a user without administrator rights is a block rule; and a managed router has not been tried against the live I2P network from the test computer. The Java I2P router needs Java, and its Windows installers carry no signature on the downloads page.
- Only a SAM bridge on `127.0.0.1:7656`, the default of both routers, is found and used.
- Nodes make outgoing I2P connections only, each from a new I2P address; a persistent I2P address that accepts incoming connections is not offered.
- The automated tests run a real Bitcoin Core against a stand-in SAM bridge, which records Bitcoin Core's greeting and session request and refuses the session; no real router and no connection to the live I2P network are part of them.
- Private broadcasting is offered with a Tor option only, although Bitcoin Core could also use I2P for it.
- Only nodes BTCortex set up can be given I2P peers from the interface.

## Electrum servers

- Only Fulcrum is set up by BTCortex. electrs and ElectrumX have no native Windows releases, so BTCortex only reads them on other computers (with Fulcrum there too): their software, chain and height, and a node's address lookups. Wallets are not pointed at such a server from BTCortex; its address is entered in the wallet.
- Fulcrum has been tested on regtest only. A mainnet index needs a full node and about a quarter of its block files' size again (an estimate; recheck against real sizes), which the test computer does not have; indexing times on mainnet are not measured.
- Wallets on this computer connect over plain TCP; other devices reach the server only through Tor (an onion service). TLS (Fulcrum's SSL port) and access over the local network are not offered.
- The onion service was reached over the real Tor network once by hand (from this computer through tor's SOCKS port); the automated tests run tor offline. Mobile wallets have not been tried.
- During the initial indexing, Fulcrum has no admin port, so BTCortex ends it instead of stopping it gracefully; Fulcrum 2 is designed for this, and indexes the last few blocks again.
- Bitcoin Knots nodes are not offered an Electrum server: whether Electrum wallets accept a Knots node's chain is not established.
- Block notifications (`zmqpubhashblock`) are added only when the node restarts anyway; without them Fulcrum asks the node for new blocks every two seconds.
- Trezor Suite's guide does not mention `127.0.0.1` as a custom Electrum server; it is expected to work, as Suite connects from this computer, but has not been tried.
- A new major Fulcrum version is not switched to automatically, since it may change the index format: servers keep running the newest installed version of their major version.

## Block explorer

- BTCortex's own explorer is built in. mempool and Esplora explorers on other computers can be followed and their pages opened, but BTCortex does not install or run them: mempool needs Docker and an unpruned node with the transaction index, Esplora well over 1 TB. They are asked only for the chain tip and block hashes, so address lookups still need an Electrum server. Only explorers serving the Esplora API at `/api` or at their root are found, and the explorer support was tested against a stand-in and, by hand, against blockstream.info's public API, not against a self-hosted mempool. Pages of an explorer reached through Tor are not opened in the ordinary browser, which would connect without Tor (and cannot reach an onion service at all): their address is copied, to open in Tor Browser. BTC RPC Explorer is researched but not installed or connected.
- Address lookups need an Electrum server: the node's own, or one on another computer added for it; without either (a pruned node, for example) only an address's script is shown. A server on another computer learns which addresses are looked up.
- Busy addresses show their latest 500 transactions; Fulcrum refuses histories beyond its own limit (125,000 entries by default).
- On a pruned node, blocks below the prune height show their headers only, and their transactions cannot be looked up.
- Fee estimates are Bitcoin Core's own; there is no fee-rate chart of the mempool in the explorer (the node's mempool page has one).

## Lightning

- Only LND is supported, and only by connecting to it: BTCortex does not install, configure or run LND for the user, because creating its wallet shows the seed, which must stay in LND's own tools. Core Lightning (no Windows build), Eclair, phoenixd and the management tools are researched only.
- BTCortex only reads. Opening, closing and rebalancing channels, paying and creating invoices, fee policies, watchtower configuration and Loop or Pool are not offered.
- A locked wallet is reported but not unlocked: the password is never asked for.
- Peers without a channel show their public key only; aliases come from the channels' graph data.
- Forwards are summed over the last 30 days, up to 50 000 events; a busier node's older forwards in that window are not counted. Routing fees per day, week and month are LND's own sums.
- The liquidity warnings use a fixed threshold (a tenth of a channel's capacity); there are no user-defined policies or notifications yet.
- Channel backups are saved on request only, not automatically after channel changes. They are kept until the user deletes them.
- Onion addresses were tested with a stand-in SOCKS proxy, not against a real LND behind an onion service.
- LND's certificate must be given unless the node has a publicly trusted one; when LND renews its certificate (`tlsautorefresh`, or a deleted `tls.cert`), the connection must be made again.

## Service orchestration

- Only what BTCortex runs is orchestrated: tor, the nodes it set up and their Electrum servers. Nodes it did not set up are shown and never started or stopped; Lightning nodes and payment servers on other computers are listed under Remote infrastructure; Sparrow and Electrum are opened from their pages and closed by the user.
- Everything can be started or stopped at once, but services are restarted one at a time.
- A plan is worked out from the state of the moment; a service that changes state while it runs (a node that fails while starting, for example) ends the run at that step.
- Modules declare their permissions; the declaration is shown, not enforced by a sandbox, because modules are built into BTCortex and run in its orchestrator.

## Storage across BTCortex

- Measurements are reused for ten minutes; walking a large node's folders can take a minute. Nodes on other computers are not measured, and neither are the databases of Lightning nodes BTCortex connects to, which stay on their own computers.
- Only two clean-ups exist, both of BTCortex's own leftovers; old logs and exports are rotated by BTCortex itself rather than removed here, and nothing is cleaned up automatically.
- WSL2 and Docker Desktop disks are shown by file size only: the space used inside them, single Docker volumes and compacting a disk are not covered. Docker Desktop's data disk is found where it is kept by default or next to its distribution; other layouts are not looked for. Docker Desktop and WSL2 are not installed on the test computer, so finding them was tested against registry entries and paths made for the test.
- Forecasts need a day of measurements and assume the pace of the last 30 days; a node still downloading the chain grows much faster than one that has caught up.

## Backups

- BTCortex's own settings and node profiles are backed up but not restored automatically; restoring them means setting things up again by hand with the backup as a reference.
- Only wallets loaded in a running node on this computer can be copied; Bitcoin Core 31 has no unnamed default wallet, older nodes' default wallet is supported.
- Automatic backups run only while BTCortex is open; a failure or an overdue backup raises an alert (see Monitoring).
- Restoring a wallet waits for Bitcoin Core's rescan, which can take hours on mainnet, and needs the blocks since the wallet was made.
- Backups go to folders; cloud destinations are reached only through a synchronised folder.

## Deployment profiles

- Profiles combine what BTCortex can set up today: the Lightning (E) and merchant (F) profiles cannot be deployed, and the maximum profile (H) has no Lightning or payment part, until BTCortex installs LND and BTCPay Server.
- Sizes of chains and indexes are estimates; download sizes are what the publishers' servers report and are not shown when they cannot be asked.
- A deployment does not choose a backup folder or open Electrum: those stay as steps for the user. Electrum wallets connect once the Electrum server has indexed, which can take days.
- A profile deployed onto an existing node changes only what BTCortex may change: Tor routing only for nodes it set up, an Electrum server only for full nodes on this computer.
- Deployments have been run end to end on regtest; mainnet runs the same code but downloads and indexes for days, which has not been run to completion.

## Developer tools

- Live events need the node to publish ZMQ notifications over TCP; BTCortex does not add them to a node's `bitcoin.conf` by itself (Electrum servers it sets up add block notifications). Raw block and transaction notifications are shown by size only.
- There is no JSON-RPC batch builder: the RPC console takes one method at a time, as Bitcoin Core's own console does.
- PSBTs are analysed, combined and finalised but never signed here; signing belongs to wallets and hardware wallets. Transactions are not built here either: coin selection is analysed, not done, since BTCortex holds no wallet.
- A transaction's explanation reads the node's decoding: signatures are not verified, and when the coins an input spends are unknown (a raw transaction the node has not seen, without the transaction index), its type is judged from its shape. Scripts are disassembled for display; miniscript is supported only as far as the node's descriptors are (`getdescriptorinfo`, `deriveaddresses`), with no policy compiler.
- Sizes and costs are estimates at the usual signature and key sizes; P2SH, P2WSH and other script coins get no cost, since their size depends on the script.
- Transactions are sent only through the chosen node. Following finds a confirmation in the blocks that arrived since following began, or anywhere with the transaction index; a transaction confirmed earlier on a node without the index stays “not found”.
- A coin search reads the node's whole UTXO set (minutes on mainnet) and one search runs at a time on a node. Fee estimates need the node to have seen enough blocks; until then, and always on regtest, the rates shown are examples.
- Payment URIs: Lightning invoices and offers, silent payment and BIP 351 addresses are shown, not checked or paid; proof-of-payment callbacks are never opened.
- Blocks are generated on regtest only. Signet and testnet4 coins come from their faucets, which BTCortex does not contact.
- Protocol features are read from the node and, for its defaults, from the research on Bitcoin Core 31.1; settings given on a command line or in `settings.json` are not seen.

## Network topology

- Only what BTCortex knows is drawn: an LND node's own Bitcoin back end, wallets other than Sparrow and the Lightning network's transport (direct or through Tor) are not shown.
- The diagram is laid out in rows; with many parts in one row it grows wider than the window and scrolls sideways. The table lists the same connections.

## Security centre

- Findings cover what BTCortex can read: `bitcoin.conf` of nodes whose files are on this computer (not `includeconf` files, `settings.json` or command lines), and Windows Firewall's on/off state per profile; rules for individual programs need administrator rights and are not read.
- Dependency auditing of BTCortex itself and signed BTCortex releases are listed as not in place yet.

## First-run guide

- Bitcoin software other than Bitcoin Core and Knots is recognised by its usual folders only; a program installed elsewhere is not listed.
- Whether outgoing Bitcoin peer-to-peer connections work is not tested before a node starts, so that no peer is contacted before you choose how the node connects (directly or through Tor).
- The Windows support status is judged from the build number only; Extended Security Updates enrolment is not detected.

## Settings and Windows integration

- Starting with Windows uses the current user's `Run` registry value: BTCortex starts when that user signs in, not before anyone signs in, and nodes BTCortex runs start only then. A Windows service that runs without a signed-in user is not provided.
- Starting in the notification area applies only to a start with Windows; opening BTCortex by hand always shows the window.
- Nodes that existed before the start-with-BTCortex choice was added keep their previous behaviour (not started automatically) until it is switched on in Settings.
- The interface is in British English only; other languages are not offered yet.

## Remote infrastructure

- BTCortex does not log in to other computers (no SSH or agent), so their resources, logs, files and programs are not shown or managed; services there are used only through their own interfaces.
- Electrum servers on other computers are read (checked every minute and used for a node's address lookups) but not managed, and wallets on this computer are not configured to use them; node packages (Umbrel, Start9, RaspiBlitz, myNode) are not recognised as such.
- A connection test is one round trip and is not repeated in the background beyond each service's own checks.

## Payments & merchants

- BTCPay Server is connected to, never installed: it runs on Linux, usually in Docker, and BTCortex does not set up Docker or WSL2.
- The client has been tested only against a stand-in server answering with the shapes of BTCPay's published OpenAPI document; no real BTCPay Server was available.
- Read-only: invoices, payouts, refunds, pull payments, webhooks and Lightning node details are not shown or managed. The Lightning node's details would need a permission that can also pay.
- Up to 20 stores per server and the 500 most recent invoices of the last 30 days per store are read; the page says when a store has more.
- BTCPay's own logs stay on its server; LNbits and other payment services are not connected yet.

## Configuration portability

- The ten most recent versions of each node's `bitcoin.conf` are kept, next to the file; older ones are deleted as new ones are kept.
- Exported copies have their secrets hidden and cannot be used as they are; an encrypted export that keeps secrets is not offered. Importing means pasting settings into the file tab; files are not read into the window, since they may hold secrets.
- Configuration profiles that can be compared or applied to several nodes are not built; deployment profiles cover new set-ups.

## Update centre

- New releases are looked up once a day while BTCortex runs, or on **Check now**, so one can go unnoticed for about a day.
- BTCortex does not update itself: its releases are not yet published with signatures it could verify, so a newer BTCortex is installed by hand.
- Nodes BTCortex does not run are shown with how serious their version is, but are updated where they were installed.
- What a move across major versions changes for good is listed for the changes the research records (§10.7 of the Bitcoin Core notes); release notes remain the full account.

## Monitoring

- BTCortex measures and raises alerts only while it runs: there is no background service, and the history has gaps for the times it was closed. Alerts appear in the window, the status bar and as Windows notifications; e-mail and messaging services are not supported.
- Disk and network activity are those of the whole computer, from Windows' performance counters: they are not split by program, and traffic through virtual adapters (a VPN, Hyper-V) may be counted on both the virtual and the physical adapter. The busy time shown is the busiest disk's. They are measured on Windows only.
- Changes to security-relevant settings are watched in `bitcoin.conf` only, not in files added with `includeconf`, in `settings.json` or on a command line. A change made while BTCortex was closed is reported at the next start as made elsewhere. The previous values are never stored, so an alert names what changed and shows new addresses and switches, but not old values.
- One level applies to both memory and processor warnings; a processor alert is only a note, because a node or an Electrum server catching up keeps the processor busy for hours.
- Resolved alerts are kept for 30 days (at most 500).

## Electrum wallet

- Electrum is opened with the user's own server for one session at a time; BTCortex does not make the server Electrum's permanent setting.
- An Electrum that is already open keeps its server: it must be closed first.
- The live check ran on regtest with a separate Electrum data folder; with the user's own data folder, Electrum opens the user's wallets as usual.

## Hardware wallets

- No physical hardware wallet has been used in BTCortex's tests yet. The whole path through Bitcoin Core is tested with a stand-in for HWI that simulates a device; the real HWI is tested without a device only (Bitcoin Core runs it and it lists devices), so how it talks to a real device is HWI's own, untested here.
- HWI is in maintenance mode upstream (its maintainer announced that the next release will likely be the last) and does not support the Trezor Safe 7 or the Ledger Nano Gen5. Those devices work through Sparrow. The pinned HWI release key expires on 21 August 2027 and must be refreshed with `packages/integrations/hwi/scripts/update-signing-key.mjs` before then.
- Bitcoin Core works with one external signer at a time: only one device may be connected while a watch-only wallet is created or used.
- Nodes keep using the HWI version they were set up with; after an HWI update, setting the node up again moves it to the new version.
- Hardware-wallet wallets on the node are single-signature; multisignature coordination is not built yet.
- QR codes use Uniform Resources (`crypto-psbt`); Coinkite's BBQr format is not offered. Reading codes with the camera is tested with generated codes only: the test computer has no camera, and whether WebView2 asks for camera permission the same way on every Windows set-up is not established.
- Firmware versions are not read from devices: they belong to the vendors' applications (Trezor Suite for Trezor).
- Trezor Suite is installed by its own installer and then updates itself; BTCortex records what it verified about the installer it ran, but does not manage Suite's later versions.

## Platform

- BTCortex has been tested on Windows 10 22H2 only. It is built for Windows 11 as well, but nothing has been checked there yet: start-up, notifications, WebView2, Windows Firewall prompts and performance counters may behave differently.
- Bitcoin Core publishes Windows builds for x64 only; there is no Windows ARM64 build upstream.
- Bitcoin Core's IPC mining interface is not available in Windows builds.
- Bitcoin Core has no Windows service mode; managed nodes run in the user session.
- If BTCortex closes while a managed node is still starting, Bitcoin Core may refuse the stop request during its warm-up, and the node then keeps running until it is stopped from BTCortex or Windows shuts down.
- On computers with less than about 1 TB of free space a mainnet node must be pruned, which rules out Electrum servers, `txindex` and wallet rescans before the node was set up. BTCortex explains this before installation.

## Ecosystem facts that limit integrations

- Bitcoin Knots 29.4.1 and later enforce a hard fork (BLAKE2b proof of work): Knots nodes follow a different chain from Bitcoin Core. Knots is therefore never offered as a drop-in replacement: BTCortex sets it up only when the user chooses it and agrees to its chain, in runtime and data folders of its own, without an Electrum server, and never moves a node between Knots and Bitcoin Core.
- Bitcoin Knots nodes are tested on regtest only. Knots' own options (relay policy such as `rejectparasites` or `datacarriercost`) are not in the configuration editor's catalogue: they are kept and shown as unknown options. The RPC console classifies the methods of Bitcoin Knots 29.4.2; those of newer Knots releases are treated as unknown (dangerous, with their parameters hidden) until classified, and Bitcoin Core's version warnings and the fee-rate diagram (Core 31.0 and later) do not apply to Knots.
- No Electrum server works with a pruned node.
- Electrum Personal Server and bwt are incompatible with Bitcoin Core 30 and later.

## Sparrow

- The connection flow is covered by unit and component tests. A complete run with a real Sparrow download and launch has not been done yet; the 2.5.5 release signature and archive layout were checked against the real files.
- Nodes that use password authentication are not offered to Sparrow, because Sparrow would store the password in plain text in its settings file.
- Sparrow must be closed while BTCortex changes its settings; BTCortex asks the user to close it rather than closing it itself.
- On a pruned node Sparrow can find transactions only in the blocks the node still keeps, so a wallet restored from an older seed does not show its earlier history. That needs an unpruned node or an Electrum server.
- Whether Sparrow's Windows executables carry an Authenticode signature is not established, so the result is recorded rather than required; trust comes from the signed release manifest.
- The pinned Sparrow release key expires on 18 September 2027. It must be refreshed with `packages/integrations/sparrow/scripts/update-signing-key.mjs` before then, or installations of newer releases will be refused.

## Engineering

- The per-user installer is built and was tested by hand (install, start without a development server, graceful close, uninstall keeping the data); the MSI is not tested, upgrades were tested only between builds of the same version number, and releases are not code-signed yet.
- The orchestrator embeds the Node.js runtime it was built with; release builds must pin the Node.js version.
- OpenPGP.js (LGPL-3.0-or-later) ships as a file of its own, `openpgp\openpgp.cjs` beside the orchestrator, so that it can be replaced; BTCortex trusts whatever build is there, as it trusts its own executables in the same folder.
- One builder signature on Bitcoin Core 31.1 (Emzy) is reported as invalid because OpenPGP.js validates keys at the signature's creation time and that key's subkey binding is newer than the signature. GnuPG accepts it. Ten other signatures are valid, well above the threshold of three.
- Desktop end-to-end tests are not set up yet.
