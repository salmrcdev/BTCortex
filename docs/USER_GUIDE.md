# BTCortex user guide

BTCortex brings the self-hosted Bitcoin ecosystem together in one Windows application. This guide follows the pages in the order of the sidebar. Every page explains itself as you use it; this document adds what happens behind it. What each feature has been tested with is in [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md).

## Principles you can rely on

- **Nothing changes without you.** Pages show a plan or an explanation first; consequential actions ask for confirmation and say exactly what will happen.
- **Verified software only.** Every program BTCortex installs comes from its official release and is checked (signatures, checksums, Windows code signatures where the publisher signs) before it is used.
- **Your secrets stay protected.** Passwords, macaroons and keys are encrypted with Windows (DPAPI) and never shown again. BTCortex never asks for a recovery phrase (seed).
- **Your data is never deleted by surprise.** Removing a node, a server or a connection from BTCortex never deletes blockchain data, wallets or backups.
- **Other programs' files are respected.** Bitcoin Core, Sparrow, Electrum and LND that were already on the computer are read, not changed (apart from a wallet's connection settings, and then only while it is closed and after a backup).

The status bar at the top shows whether the window is connected to BTCortex's orchestrator, the background program that does the work. The sun and moon button switches between light and dark; Settings can also follow Windows.

**Search** in the status bar, or `Ctrl+K` anywhere, finds any page, node or node section and a few actions as you type; paste a block height, block hash, transaction ID or address to look it up in the explorer. `Ctrl+B` hides or shows the sidebar labels, `Ctrl+,` opens Settings, and `?` lists the shortcuts. Pages inside an area, such as a node's sections, show where they are above their title.

## The first start

While nothing is set up, BTCortex opens a short guide. Choose **Let BTCortex recommend** or **Choose every detail**, then **Check this computer**: BTCortex looks at Windows, the processor, memory and disk, Bitcoin software already installed, WSL2 and Docker (not needed), the usual ports and what the network allows, and changes nothing. It then recommends a set-up for this computer — or offers to use the node already here — and shows the full plan before anything is installed. **Skip the guide** is always available; the guide can be opened again from the search (`Ctrl+K`).

## General

### Overview

How everything is doing at a glance — every service, this computer's processor, memory, disks and disk and network activity — with the alerts that need attention, the state of BTCortex (version, data folder) and of this computer, a summary of your nodes and of Tor, and the next step when something is not set up yet. The bell in the status bar counts the alerts that need attention and opens the monitoring page.

### Deployment profiles

Ready-made combinations — a basic node (A), a private wallet set-up with your own Electrum server and Sparrow (B), a node that uses only Tor (C), a full explorer (D), an advanced workstation (G) and the largest stack BTCortex can run (H) — with what each part is and whether BTCortex installs it, provides it itself, or cannot deploy it yet (Lightning, E, and BTCPay Server, F, say why). Choose one, then:

1. **Customise**: a new node or one BTCortex already has, the network, the optional parts, and for Tor how the node uses it.
2. **Review**: what happens step by step, what is downloaded (with the real size and how it is checked), the disk space, memory and processors it needs on this computer, the ports and who can reach them, and what it means for your privacy and security. Nothing changes yet.
3. **Deploy**: after your confirmation, BTCortex carries out the steps one after the other and shows each one. If a step fails, the others stay in place and the step says where to finish it; anything that needs your decision — such as replacing a server you chose in Sparrow — is left to you.

### Catalogue

Every researched project of the Bitcoin ecosystem: nodes, Electrum servers, explorers, wallets, hardware wallets, Lightning implementations and tools, privacy networks and more. Each entry says what it is, whether it runs on Windows, how BTCortex supports it (or that it is research only), its dependencies checked against what is on this computer, and the sources its facts come from, with dates. An entry is called available only when BTCortex has built and tested its integration; its page then links to where it is managed.

### Service orchestration

Every service BTCortex runs — Tor, your nodes and their Electrum servers — in the order they start, each with its state, what it needs and what needs it, and a link to its logs. **Start…**, **Stop…** and **Restart…** first show what will happen, in order: starting an Electrum server starts its node first, and stopping a node stops its Electrum server first; whatever loses something without being stopped, such as a node that loses its onion peers when Tor stops, is named. **Start everything…** and **Stop everything…** do the same for all of them. Nodes BTCortex did not set up are shown, never started or stopped. Below, the integration modules these services belong to: how they are tested, what each may do on this computer, what it depends on, and its help and updates.

## Bitcoin

### Bitcoin nodes

Your nodes, each with its network, state, block height, peers and synchronisation progress. From here:

- **Set up Bitcoin Core** — choose the software (Bitcoin Core, or Bitcoin Knots, which since 29.4.1 follows another chain and is set up only once you agree to that), a network (mainnet, testnet4, signet, regtest) and a purpose (general use, back end for wallets, node with an Electrum server, which Knots nodes do not get). BTCortex proposes a plan for this computer: where the data goes and how much room it needs, pruning when the disk is small, memory for the cache, and settings for the purpose. Approve it once; the verified download, configuration and first start run as a job you can follow.
- **Found on this computer** — Bitcoin Core already installed is listed with its folder and state, and connected with one click. If its window does not accept connections yet, BTCortex tells you which option to tick.
- **A node on another computer** — connect Bitcoin Core running elsewhere with its RPC address, user name and password. BTCortex tests the connection first and refuses plain HTTP outside your local network.

Each node has its own page with tabs:

- **Overview** — synchronisation (with a clearly labelled estimate), chain, version, uptime, traffic; start, stop and restart for nodes BTCortex manages (stopping asks first); connecting Sparrow to the node.
- **Network & peers** — connected peers with their software, direction, network (IPv4, IPv6, Tor, I2P, CJDNS), traffic and ping; disconnecting, banning and adding peers.
- **Mempool** — the node's own mempool: size, fee-rate distribution, fee estimates, policy, recent history, and a look-up of any waiting transaction.
- **Storage** — the disk, the node's folders and their sizes, pruning and indexes; switching indexes on or off, rebuilding them and verifying the latest blocks (for nodes BTCortex set up).
- **Configuration** — the node's `bitcoin.conf`, option by option with explanations, defaults and risks; changes are validated, shown as a difference and saved with a backup of the previous file.
- **Console** — the node's RPC interface, as in Bitcoin Core's own console, with a read-only mode and a list of methods. Methods that would pass private keys or wallet passphrases are refused, including the legacy-wallet ones of Bitcoin Knots and older Bitcoin Core such as `dumpprivkey` and `importprivkey`.
- **Privacy** — how the node connects: directly, through Tor as well, or only through Tor, and whether it offers an onion service.

See [`NODE_MANAGEMENT.md`](NODE_MANAGEMENT.md) for details.

Each node's **Configuration** keeps the file as it was before each of your last ten saves under **Earlier versions**: **Compare** shows what a version would change (secret values stay hidden), and **Restore…** puts it back through the same checks as a save, keeping the current file as a version so that a restore can be undone. **Export without secrets…** saves a copy to share or keep elsewhere, with passwords and keys hidden.

### Explorer

**Explorers on other computers**, at the foot of the explorer's overview, follows a mempool or Esplora explorer you run elsewhere (for example on a node platform): BTCortex tests it first, checks every minute that it answers and follows the right chain, and adds **Open in** buttons to blocks, transactions and addresses, which open the explorer's page in your browser. The explorer then learns what you opened. For an explorer reached through Tor, the button copies the page's address instead, to open in Tor Browser: your ordinary browser would connect without Tor.

Search for a block height or hash, a transaction id, an address, a raw transaction or a script, and browse blocks and transactions from your own node: fees, the coins a transaction spends, which outputs are spent, unconfirmed parents and children. Address history needs the node's Electrum server, because Bitcoin Core keeps no index of addresses (or an Electrum server on another computer that you added for the node). No public service is asked.

### Wallets

Sparrow and Electrum for the node you choose, in one place: BTCortex installs and verifies Sparrow, points it at the node — or at its Electrum server once that is ready — and opens it; it opens the Electrum already on your computer (or its own verified copy) with your own server, without changing Electrum's settings. Hardware wallets sign through them or through BTCortex's signer, and other wallets — Trezor Suite, Specter, Nunchuk, phones — use the Electrum server's address shown on its page. Wallets and keys stay inside those programs.

### Electrum servers

For each node on this computer: whether it can have an Electrum server (it must keep every block), and what setting one up involves, shown before anything changes. BTCortex then installs Fulcrum, turns on the node's transaction index (restarting it once), and runs Fulcrum next to the node, showing its indexing progress, connected wallets and how each wallet connects; Sparrow and Electrum can be connected to it from the same page. On request, the server can be reached from your other devices as an onion service of BTCortex's tor.

**Electrum servers on other computers** adds a server you already run — electrs, Fulcrum or ElectrumX on Umbrel, StartOS, RaspiBlitz or another machine — directly or through Tor, over TCP or TLS. **Test the server** shows its software, chain and height, and its certificate: when no authority Windows trusts vouches for it, as is usual for your own server, compare the fingerprint with the one your server shows and tick that it is yours; BTCortex then refuses any other certificate. A server added for a node answers that node's address lookups in the explorer while the node's own Electrum server is not ready (none set up, still indexing, stopped or failed). BTCortex checks such servers every minute and only reads them.

### Lightning

Connect your LND node — the one on this computer in one click, or one elsewhere with its address, certificate and macaroon, or an lndconnect address — and see its channels and their liquidity, pending channels, peers, payments, invoices, routing fees and forwards, with warnings for anything that needs attention. Save the node's channel backup from here. BTCortex only reads, with LND's read-only macaroon; it never moves funds. See [`LIGHTNING_INTEGRATIONS.md`](LIGHTNING_INTEGRATIONS.md).

### Payments & merchants

Connect a BTCPay Server you run elsewhere — on a server of your own or at a hosting provider — with its address and an API key. **Create the key in BTCPay** opens BTCPay's own form with only the permissions BTCortex needs, none of which can spend, refund or change a store; paste the key back into BTCortex, which tests it before keeping it encrypted. The page then shows whether the server runs and keeps up with the chain, and for each store its payment methods, on-chain balance and the invoices of the last 30 days. Onion addresses are reached through Tor. BTCortex never creates, changes or pays anything in BTCPay, and BTCPay keeps its own backups (the page explains how).

### Hardware wallets

Use a hardware wallet with your own node in four steps: install HWI (verified), let the node use hardware wallets, connect and unlock the device, create a watch-only wallet on the node. BTCortex recognises connected devices without opening them, installs and opens Trezor Suite for device set-up and firmware, shows receive addresses on the device for checking, and builds transactions that you sign on the device (by USB, file or QR code) before they are broadcast. See [`WALLET_INTEGRATIONS.md`](WALLET_INTEGRATIONS.md).

### Developer tools

- **Decode**: a raw transaction, a script, a PSBT (what it spends and pays, the fee, what is still missing and who acts next), an output descriptor (its checksum and first addresses) or an address (whether it is valid on the node's network, with its mistakes marked), all with the node you choose. A transaction is explained as well: its lock time and whether it binds, whether it signals replacement and whether this node needs the signal, what each input spends with its sequence, signatures, script and Taproot details, the witness discount, and outputs below the dust limit. Paste several PSBTs, one per line, to combine them; **Finalise** turns a signed PSBT into its transaction. **Send to the network…** appears only when the node's mempool would accept the transaction, and asks first. Sent transactions, and those you choose to **Follow**, are listed until they confirm. Descriptors with private keys are refused. The RPC console of the chosen node is one click away.
- **Payment URIs**: make a `bitcoin:` link with its QR code for an address, amount, label and message, or read one to see what it asks for, checked by BIP 321 and the node. Reading a link pays nothing and opens nothing.
- **Coins**: look up whether an output is still unspent, or find every coin of addresses and public descriptors in the node's UTXO set — without a wallet — with what each costs to spend at the node's fee estimates, dust, new coins not yet spendable, coins sharing an address and what spending them all at once would cost. On mainnet a search reads the whole UTXO set and takes a few minutes; **Stop** ends it.
- **Convert**: amounts between BTC, mBTC, bits and satoshis; fee rates between sat/vB, BTC/kvB and sat/kWU; the size and fee of a transaction from how many inputs and outputs of each type it has; text and hexadecimal, with byte order reversed as transaction ids are shown; JSON formatted or compacted.
- **Protocol features**: what the node applies — consensus rules such as Taproot, relay policy such as package relay, TRUC transactions, cluster mempool and OP_RETURN limits, wallet policy, implementation-specific features such as encrypted P2P transport (BIP324), compact block filters and private broadcast, and experimental ones — each with its state on the node.
- **Live events**: blocks and transactions as the node announces them over ZMQ — new blocks, transactions added to and removed from the mempool, with counts, a rate and links to the explorer — while the tab is open. The node needs `zmqpubhashblock`, `zmqpubhashtx` and `zmqpubsequence` in its `bitcoin.conf`; Electrum servers set up by BTCortex add the block notifications themselves.
- **Test networks**: nodes on test networks, with their console and explorer; on regtest, generate blocks, to an address of yours or to nobody.
- **Endpoints**: check a service — any TCP port, a web server, an Electrum server or a Bitcoin node's RPC interface — directly or through Tor, step by step: name lookup, connection, TLS and the service's answer. No credentials are sent.

### Network topology

A diagram of how BTCortex, Sparrow, your Electrum servers and Lightning nodes, your Bitcoin nodes, tor and the networks connect right now — each connection with its protocol and port, whether it stays on this computer, goes through Tor or travels unencrypted, and whether it is live (solid) or idle (dashed). Point at a part to see only its connections; click it to open its page. The same connections are listed in a table below the diagram, and the whole view updates by itself.

### Remote infrastructure

Everything BTCortex reaches on other computers — Bitcoin nodes, LND nodes and BTCPay Servers — grouped by computer, with how each is reached (local network, internet or Tor), what BTCortex may do there, and **Test the connection**, which times one round trip. BTCortex uses only each service's own interface and never logs in to those computers.

### Tor & Privacy

BTCortex's own tor: installed from the Tor Project's verified release, started when nodes need it, with its bootstrap progress, circuit health and the nodes using it. Tor that is already running on the computer (Tor Browser, a tor service) is recognised but not used for BTCortex's nodes. See [`PRIVACY_AND_TOR.md`](PRIVACY_AND_TOR.md).

The **I2P** card looks for an I2P router you run yourself (i2pd, or the Java I2P router with its SAM bridge started) and says where to get one when there is none. Once a router answers, a node's Privacy section can add I2P peers to any of its connection choices; each I2P connection then uses a new I2P address, and the node accepts none.

## System

### Installed software

Every program BTCortex installed, by version, with where it came from and how it was verified. Check for updates, install an update (verified like the first installation), check that the installed files are unchanged, and remove a version no node uses.

### Updates

What can be updated and how much it matters. For each program BTCortex installed: the newest release, whether staying on your version is a security risk, what updating touches, and its release notes. **Install** verifies and installs the release like the first installation; **Remind me in 7 days** or **Skip this version** puts it off, although updates that matter for security keep a reminder in Monitoring. For each node: the Bitcoin Core version it runs and, when a newer one is installed, **Move to…**, which first lists what changes for good — Bitcoin Core cannot go back to an older version — and when the last backup was made. BTCortex looks for new releases once a day while it runs; **Check now** looks at once. BTCortex itself is not updated from here yet.

### Monitoring

The health of every service with a link to each, this computer's resources, the alerts BTCortex raised, and the errors it logged in the last day.

- **Alerts** appear when something needs attention — a node stopped or stuck, a disk nearly full, tor or an Electrum server stopped, a Lightning node unreachable or its macaroon or certificate about to expire, a BTCPay Server not answering, a backup failed or overdue, memory nearly used up, an update available — and close by themselves once the cause is gone. Passing trouble, such as a node restarting, must last a few minutes first. **Mark as seen** keeps an alert listed until its cause is gone. New warnings and critical alerts also appear as a message in the window and, if Windows allows it, as a Windows notification.
- **Security settings**: when settings in a node's `bitcoin.conf` that open it to other computers, run programs or change how it signs in or connects are changed, BTCortex says so — as a note when you changed them in BTCortex, as a warning when they were changed elsewhere. If you did not make such a change, look at the file at once. **Dismiss** removes the alert.
- **History**: choose a period from an hour to a year and up to four metrics — processor, memory, disk and network activity of this computer, and each node's peers, mempool, traffic and synchronisation — each in its own chart on the same time scale. Gaps show when BTCortex was not running. **Export as CSV** saves the chosen metrics for a spreadsheet; **Export a report** saves a plain-text summary of the period.
- **Settings**: how long samples are kept, the free space that raises a warning or a critical alert, the memory and processor use that raises a warning, and which alerts become Windows notifications.

BTCortex measures and raises alerts only while it runs; it does not send e-mail or messages.

### Storage

The disks BTCortex's data is on and how full each is, every folder it keeps or reads with the service that owns it and its size, and how fast each node's block files grow: from a day of measurements on, it says when the disk would be full at that pace, and warns when that is less than a month away. Nodes link to their own **Storage** tab, where pruning and indexes are changed.

Only BTCortex's own leftovers can be removed here, each after saying what goes: downloads and installations that did not finish, and temporary copies left by an interrupted backup or restore, once they are more than an hour old and while no job is running. Blockchain data, indexes, wallets, backups and exports are never deleted from this page, whatever their names; folders of nodes BTCortex did not set up are marked read-only. When this computer has WSL2 or Docker Desktop disks, they are listed with their size, although BTCortex uses neither. Measuring walks every folder, so the result is reused for ten minutes; **Measure again** measures at once.

### Backups

What BTCortex can back up, kept apart by kind — configuration, wallets, public descriptors, Lightning channel backups and credentials — and what it leaves out on purpose (blockchain data, indexes, and seeds, which it never sees). Choose a folder (ideally on another disk), back up now or automatically, keep a number of backups, and encrypt them with a passphrase, which wallets and credentials require. Every backup is checked as soon as it is written; **Verify** checks it again, and **Restore…** shows what restoring would do before anything changes. See [`BACKUP_AND_RECOVERY.md`](BACKUP_AND_RECOVERY.md).

### Security centre

What BTCortex can see of the security of your nodes, the services beside them and this computer, sorted by how serious it is — critical, should change, worth knowing, in order — each with what to do and a link to where it is done: a node's RPC interface open to other computers, the REST interface, commands run on events, a password in plain text, an outdated or withdrawn Bitcoin Core, a Bitcoin Knots node that follows a chain Bitcoin Core rejects, a macaroon that can move funds, Tor's version, backups, Windows Firewall and who can read BTCortex's data. It also lists the protections BTCortex applies itself, and the ones not in place yet. Nothing is changed from this page.

### Logs & diagnostics

The logs of BTCortex, its window, tor, Electrum servers and every node on this computer in one place, with filters by source, severity, time and text, followed live or paused. Secrets are removed before anything is shown. **Create a diagnostic bundle** writes a ZIP file with recent logs, versions and states for support; it is redacted the same way and never contains passwords, cookies, macaroons or keys.

### Settings

- **Appearance**: follow Windows' light or dark mode (the default), or always light or dark.
- **Starting and closing**: start BTCortex when you sign in to Windows (for your account only, without administrator rights), optionally straight into the notification area; and keep it running in the notification area when you close the window, so monitoring, alerts and Windows notifications carry on. Its icon there opens the window with a click; its menu has **Quit BTCortex**. If Windows' own start-up settings have turned BTCortex off, the page says so.
- **Nodes when BTCortex starts and quits**: for each node BTCortex runs, whether it starts when BTCortex starts and whether it keeps running after BTCortex quits. Nodes BTCortex sets up start with it and stop with it unless you choose otherwise. A node's Electrum server follows it; nodes BTCortex only connects to are left alone.
- **Data and privacy** shows where BTCortex keeps its data and what it sends (no telemetry); **About** shows the versions.

### Help & documentation

Every document that comes with BTCortex — this guide, installation, troubleshooting, privacy and Tor, backups, the security model, the known limitations and what has been tested — searchable and readable in the window. `F1` on any page opens the part that explains it.

## When something goes wrong

Errors say what happened, which component is affected, whether your data is at risk, the likely cause and what you can do. [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) covers the common cases.
