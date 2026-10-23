# Privacy and Tor

How BTCortex uses Tor, what each setting protects and what it does not. The technical reference behind these choices is [`research/notes/privacy-networking.md`](research/notes/privacy-networking.md) §2; the implementation is described in [`ARCHITECTURE.md`](ARCHITECTURE.md#tor).

## Three kinds of protection

| Kind                    | Examples                            | Hides                                                                       | Does not hide                                                                   |
| ----------------------- | ----------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Anonymity network       | Tor                                 | This computer's IP address from peers; from the internet provider, what for | That Tor is used; what the application itself reveals (addresses, transactions) |
| Encrypted tunnel or VPN | WireGuard, OpenSSH, commercial VPNs | Content and destinations from the local network and the internet provider   | Everything, from the tunnel or VPN operator                                     |
| Private network         | Tailscale, ZeroTier, NetBird        | Services from everyone outside the network                                  | Membership and addresses, from the coordination server operator                 |

BTCortex never calls a VPN or private-network connection anonymous.

## BTCortex's tor

- BTCortex installs the **Tor Expert Bundle**, the Tor Project's standalone tor for Windows, and nothing else. Before anything is installed, the checksum file and the archive must both carry a valid signature from the Tor Browser Developers key (primary fingerprint `EF6E 286D DA85 EA2A 4BA7 DE68 4E2C 6E87 9329 8290`), and the archive must match the signed checksum. The extracted tor must start and report its version before the installation is used.
- tor runs as an ordinary program of the signed-in user: no administrator rights, no Windows service, nothing installed system-wide. Its listeners are on 127.0.0.1 only:

  | Port (first choice) | Purpose                                                                               |
  | ------------------- | ------------------------------------------------------------------------------------- |
  | 9050                | SOCKS for Bitcoin nodes                                                               |
  | 9052                | SOCKS for wallets and other applications, so their circuits never mix with the nodes' |
  | 9054                | Control port, cookie authentication only                                              |

  The control port is deliberately not tor's usual 9051: Bitcoin Core looks for tor there by default and, if it accepts incoming connections, would publish an onion service through it without being asked. When a port is taken, BTCortex picks a free one at the first start and keeps it.

- The control cookie lives in BTCortex's folder under `%LOCALAPPDATA%`, which other Windows users cannot read. BTCortex authenticates with SAFECOOKIE, so the cookie itself is never sent, and a program pretending to be tor on the port is detected.
- tor is updated like the other installed software, with the same verification. tor ships security releases often, so a running tor moves to an update at once by restarting.
- tor's notices are in **Logs & diagnostics** and on the **Tor & Privacy** page, at notice level with `SafeLogging`, which keeps addresses out of the log.

Tor Browser runs its own tor only while the browser is open, and owns it. BTCortex does not use it, or any other program's tor, for the nodes; it only reports them.

## How a node connects

On a node's **Privacy** section (nodes BTCortex set up):

| Choice                                 | `bitcoin.conf`                      | Gains                                                              | Remaining exposure                                                                                  |
| -------------------------------------- | ----------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Directly (BTCortex's default)          | no proxy, `listen=0`                | Fastest synchronisation                                            | Peers see the IP address; the internet provider sees Bitcoin use                                    |
| Directly, plus onion peers through Tor | `onion=`                            | More peers, on the Tor network too                                 | Peers reached directly still see the IP address                                                     |
| Every connection through Tor           | `proxy=`, `onion=`                  | Peers do not learn the IP address; name lookups go through Tor too | The internet provider sees Tor; Tor exit relays see which ordinary peers are contacted; slower sync |
| Only through Tor                       | `proxy=`, `onion=`, `onlynet=onion` | No exit relays involved                                            | Fewer peers make the node easier to isolate; slower sync                                            |

Name lookups: Bitcoin Core takes its DNS proxy from `proxy=`, not from `onion=`, so only "every connection through Tor" and "only through Tor" keep name lookups away from the internet provider's DNS servers.

**Onion service.** With a Tor option, the node can accept connections through its own onion service: `listen=1`, `listenonion=1`, `torcontrol=` on BTCortex's control port and a single `bind=127.0.0.1:<port>=onion`. Nothing listens on the network itself, so no router or firewall change is needed and Windows asks no firewall question; `discover=0` keeps the node from also announcing this computer's own addresses. Bitcoin Core creates the service, keeps its key in its data directory (so the address survives restarts) and reports the address, which BTCortex shows. Anyone who knows the address can connect to the node, though not learn where it is.

**Private broadcasting** (Bitcoin Core 31.1 and later). `privatebroadcast=1` sends transactions submitted to the node, for example by Sparrow, over short-lived Tor connections, without putting them in the node's mempool first, so no peer learns that they came from this computer. Bitcoin Core 31.0 could reveal the sender in one case, which is why BTCortex requires 31.1.

BTCortex writes these options through the configuration editor's machinery: the previous file is kept as a backup, the same checks apply, and the node restarts with the new settings. Whenever a node that routes through Tor starts, tor is started first; a node that would have no connections without tor is not started when tor cannot run, and says why.

## I2P peers

I2P is a second anonymity network. Bitcoin Core reaches I2P peers through an **I2P router running on this computer**, using the router's SAM bridge; BTCortex does not install or run the router (see [`KNOWN_LIMITATIONS.md`](KNOWN_LIMITATIONS.md)). Two routers work: **i2pd**, a small router whose SAM bridge is on from the start, and the **Java I2P router**, whose SAM bridge stays off until it is started on the router console's Clients page (`http://127.0.0.1:7657/configclients`).

- The **Tor & Privacy** page looks for a router by greeting its SAM bridge on `127.0.0.1:7656` (`HELLO VERSION MIN=3.1 MAX=3.3`; Bitcoin Core needs SAM 3.1) and names the program Windows reports on that port. When the bridge does not answer, the routers' consoles (`127.0.0.1:7070` for i2pd, `127.0.0.1:7657` for the Java router) tell a router without its bridge from no router at all, and the page says what to turn on.
- On a node's **Privacy** section, **Also connect to I2P peers** adds `i2psam=127.0.0.1:7656` and `i2pacceptincoming=0` to any of the choices above, and `onlynet=i2p` next to `onlynet=onion` with "Only through Tor". BTCortex turns it on only while a router answers.
- **Remaining exposure.** Unlike Tor, the peer at the other end of an I2P connection sees the I2P address it comes from. With `i2pacceptincoming=0`, Bitcoin Core uses a new, short-lived I2P address for every connection it makes and accepts none, so peers cannot link one connection to another by that address. The internet provider sees that I2P is used.
- A node whose router stops keeps its other peers and still starts; the Privacy section then says that no router answers.

## Electrum servers through Tor

An Electrum server BTCortex runs can be made reachable from other devices as an onion service of BTCortex's tor (Electrum servers page → Access from other devices). Nothing is opened on the router or in Windows Firewall: tor connects out to the Tor network, and wallets reach the server through Tor from anywhere, encrypted end to end by Tor.

- The server answers anyone who knows its onion address, so the address should be given only to the user's own devices. It stays the same when access is turned off and on again; its key is kept in the DPAPI vault and is deleted when the server is removed.
- Wallets need Tor: Sparrow has its own; Electrum needs a SOCKS proxy (BTCortex's application port, normally `127.0.0.1:9052`); phones need a wallet with Tor built in, or Orbot.
- A newly published service can take a minute or two to become reachable (in the live check it answered after about ten seconds).

## Lightning nodes through Tor

A connection to an LND whose REST address is an onion address goes through BTCortex's tor, on its application SOCKS port, which must be running. The onion name is handed to tor unresolved, so it never reaches the local resolver, and each connection uses its own SOCKS user name, so tor gives it circuits of its own (`IsolateSOCKSAuth`). LND's certificate is pinned as for any other address.

## When tor cannot connect

The **Tor & Privacy** page shows tor's own progress and summary. Common causes, as tor reports them:

- **Wrong clock**: the Tor network refuses a computer whose clock is far off. Let Windows set the time automatically, then start Tor again.
- **Blocked network**: a firewall, proxy or network operator blocks Tor. Bridges, which disguise Tor connections, are not available in BTCortex yet.
- **No progress for two minutes**: shown as such; tor keeps trying.
- **Port in use**: another program holds one of tor's ports; BTCortex names it and does not start tor.

## What Tor does not fix

- A wallet connected to a public Electrum server tells that server which addresses are yours, with or without Tor. Connecting the wallet to your own node avoids that.
- Tor hides the IP address, not what is sent: reused addresses and linked transactions remain linkable on the blockchain.
- BTCortex never routes the whole computer through Tor and never changes Windows' DNS settings; it configures the applications it manages, one by one.
