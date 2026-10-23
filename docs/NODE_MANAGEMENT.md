# Node management

How BTCortex installs, configures, runs and watches Bitcoin nodes, and what it does with nodes it did not set up. The implementation is described in [`ARCHITECTURE.md`](ARCHITECTURE.md#bitcoin-core-integration); what is tested is in [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md).

## Kinds of node

| Kind                       | How it arrives                                                    | What BTCortex does                                                                                                                               |
| -------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Managed**                | Set up by BTCortex (**Set up Bitcoin Core**)                      | Installs, configures, starts, stops, restarts, edits its configuration, changes indexes and pruning, moves it to newer versions                  |
| **Found on this computer** | Bitcoin Core that was already installed, connected with one click | Monitors it, connects wallets to it, reads and verifies; never starts or stops it, and never changes its files                                   |
| **On another computer**    | Connected by RPC address, user name and password                  | Monitors it, browses it in the explorer and offers its RPC console; never starts, stops or changes it. Wallets are connected on its own computer |

Bitcoin Knots nodes that are already running are recognised by their version string and monitored like Bitcoin Core. BTCortex sets up Bitcoin Knots only when you choose it; see [Bitcoin Knots](#bitcoin-knots).

## Setting up Bitcoin Core

1. **Plan.** Choose the network and what the node is for. BTCortex looks at this computer — free space and the kind of disk, memory, processor — and proposes: a data folder, whether to prune (when the whole chain does not fit, with a target that leaves room), a database cache sized to the memory, `listen=0` (no inbound connections, so no router mapping and no firewall prompt), and the settings the purpose needs (an Electrum server needs every block and the transaction index). Nothing is written yet; you can choose another folder.
2. **Verified installation.** The latest final release of Bitcoin Core is downloaded from bitcoincore.org. `SHA256SUMS` must carry valid signatures from at least three of the builders whose keys are pinned in BTCortex (from `bitcoin-core/guix.sigs`), the ZIP must match its checksum, it is extracted with path and size checks, and every executable must carry the Bitcoin Core code signature. A record of this verification is kept next to the installation. Withdrawn releases (30.0, 30.1) and release candidates are never installed automatically.
3. **Configuration.** `bitcoin.conf` is written once, with the network pinned (`chain=`) so the folder can never start on another network by accident. An existing file is never overwritten. A second node of the same network gets RPC and peer ports of its own (`rpcport`, `port`): those of the other nodes BTCortex knows count even while they are stopped, and so do those of Bitcoin data folders found on this computer that hold that network's chain.
4. **First start**, followed as a job you can watch.

## Bitcoin Knots

On **Set up a node**, **Software** offers Bitcoin Knots next to Bitcoin Core, which stays the default. Since 29.4.1, Knots requires a BLAKE2b proof of work and the BIP110 rules from mainnet block 961,640, which Bitcoin Core rejects, so a Knots node follows another chain than Bitcoin Core's. The plan therefore says what that means — transactions confirmed on one chain are not confirmed on the other, wallets and services connected to the node see the Knots chain, and releases stop accepting new blocks about two years after they are published unless updated — and the set-up runs only once you have ticked that you understand it.

- **Verified installation.** The portable "pgpverifiable" ZIP comes from bitcoinknots.org (never the installer, which would use Bitcoin Core's folder). `SHA256SUMS` must carry valid signatures from at least three builders whose keys are pinned in BTCortex from `bitcoinknots/guix.sigs`, one of them the maintainer Luke Dashjr's (`1A3E 761F 19D2 CC77 85C5 502E A291 A2C4 5D0C 504A`). Builders count as people: `bigshiny90` and `shiny`, two keys with the same e-mail address, count once. The executables carry no Windows code signature, so before the installation is used its `bitcoind -version` must report Bitcoin Knots of that version; it runs with an empty data directory of its own and `-nosettings`, because bitcoind writes `settings.json` into its data directory even for `-version`.
- **Kept apart.** Knots runtimes live in their own folder, each Knots node gets its own data folder marked as Knots data in its `bitcoin.conf`, and a node is never moved between Bitcoin Knots and Bitcoin Core in either direction.
- **No Electrum server** is set up for a Knots node: whether Electrum wallets accept its chain is not established.
- The security centre lists a Knots node BTCortex set up as worth knowing; one connected from elsewhere is flagged as critical on mainnet.

## Running a managed node

- **Start** launches `bitcoind.exe` directly (no shell, no window), with its console output kept for start-up errors. **Stop** asks Bitcoin Core to stop through RPC and waits for it to finish; it always asks first. **Restart** stops and starts again.
- **When BTCortex closes**, managed nodes are stopped gracefully, unless a node is set to keep running after BTCortex closes. Nodes BTCortex did not set up are never stopped when it closes.
- **Monitoring** follows each node with an interval that adapts to its state (every 2 s while starting, 5 s while synchronising, 15 s once in step), backs off up to a minute when it does not answer, and checks that the node is on the network its profile says. Synchronisation progress comes from Bitcoin Core; the time left is an estimate and is always labelled as one.
- **History**: height, peers and mempool size are sampled once a minute and kept for 24 hours while BTCortex runs.

## Configuration

The **Configuration** tab shows the node's `bitcoin.conf` as Bitcoin Core reads it, option by option, with what each does, its default, the versions that have it and its risk; a text editor works on the same draft. Every change is validated as you type, shown as a difference before saving, and saved atomically with a backup of the previous file (the ten newest are kept).

- Passwords and `rpcauth` values never leave BTCortex's orchestrator: they are replaced by placeholders in the editor and put back only where they were.
- Settings BTCortex relies on (network, RPC port, cookie, credentials, data folder, `includeconf`) cannot be changed from the editor. Options that widen exposure, run commands or rebuild data need explicit confirmation.
- A file changed by something else meanwhile is not overwritten; the page says so.
- Nodes BTCortex did not set up are shown read-only.

## Storage, pruning and indexes

The **Storage** tab measures the disk and the node's folders and explains pruning and the indexes (transaction index, block filters, coin statistics, spent outputs). For managed nodes it can switch indexes on or off and switch pruning on, change its target or switch it off, each confirmed with its consequences and followed by a restart; leaving pruning re-downloads and re-verifies the chain after checking it fits. **Verify the latest blocks** (`verifychain`) works on every node. Rebuilding the chain state or the whole index is offered as a one-time start option that never stays in `bitcoin.conf`. Combinations Bitcoin Core refuses (for example pruning with the transaction index) are refused first, with the reason.

## Peers, privacy and the mempool

- **Network & peers** lists connected peers with their network (IPv4, IPv6, Tor, I2P, CJDNS), software, direction and traffic, and can disconnect, ban (never the computer's own address, through which Tor and I2P peers arrive) and add peers.
- **Privacy** sets how the node connects: directly, also through Tor, or only through Tor, with an optional onion service. BTCortex's tor starts first when a node needs it; see [`PRIVACY_AND_TOR.md`](PRIVACY_AND_TOR.md).
- **Mempool** shows the node's own mempool and fee estimates. Other nodes may hold other transactions, and the page says so.

## Versions and updates

Each Bitcoin Core version is installed into its own folder. **Installed software** finds newer releases and installs them (verified the same way) without touching the version a node runs; you then move a node to the new version, which restarts it if it runs. Moving back to an older version is not offered, because Bitcoin Core does not promise that an older version reads a data folder a newer one has upgraded. Bitcoin Knots versions work the same way among themselves, once Knots is installed; a Knots release can change the rules its nodes follow, so read its release notes before moving a node.

## Removing a node

Removing a node from BTCortex forgets its profile and deletes its stored password, if any. Its data folder — blockchain, indexes and wallets — is never deleted; the page tells you where it is. A managed node must be stopped first: BTCortex checks the process itself, so a bitcoind that runs without answering (busy, or after an error) is offered **Stop**, never **Remove**.

A node's Electrum server goes with it, and the confirmation says so first: the server stops and is forgotten, its onion address is withdrawn for good (the service is removed from Tor and its key deleted, so a server set up later gets a new address), and its index folder stays where it is, which the dialogue and the confirmation name.

## Wallets on the node

BTCortex does not manage keys. It connects wallet software to the node (Sparrow, Electrum through the node's Electrum server) and can create watch-only wallets for hardware wallets; see [`WALLET_INTEGRATIONS.md`](WALLET_INTEGRATIONS.md). The RPC console refuses methods that would pass private keys or wallet passphrases through BTCortex.
