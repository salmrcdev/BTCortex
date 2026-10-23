# Remote nodes and services

What BTCortex can do with nodes and services on other computers today, how it protects the connection, and what is not built yet (specification section 26).

## What works

| On another computer                                      | How BTCortex reaches it                                                                                                           | What it does                                                                                                                                                                                                                                               |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Bitcoin Core** (or Bitcoin Knots)                      | RPC address, user name and password (**Bitcoin nodes → A node on another computer**)                                              | Monitors it (synchronisation, peers, mempool), browses it in the explorer and offers its RPC console. Wallets are connected on that computer: Sparrow needs a node's cookie, and an Electrum server or a hardware wallet's signer belongs next to its node |
| **LND**                                                  | REST address with LND's `tls.cert` and a macaroon, or an lndconnect address; onion addresses through Tor                          | Reads channels, liquidity, payments and routing; saves channel backups                                                                                                                                                                                     |
| **BTCPay Server**                                        | Its address and a read-only Greenfield API key (**Payments & merchants**); onion addresses through Tor                            | Watches the server and its synchronisation, and reads each store's payment methods, on-chain balance and recent invoices                                                                                                                                   |
| **Electrum servers** (electrs, Fulcrum, ElectrumX)       | Host and port, over TCP or TLS (a certificate no authority vouches for is pinned once you accept it); onion addresses through Tor | Checks every minute that it answers and follows the right chain; answers a node's address lookups while the node's own Electrum server is not ready                                                                                                        |
| **Block explorers** (mempool, Esplora)                   | The explorer's address; onion addresses through Tor (**Explorer → Explorers on other computers**)                                 | Checks every minute that it answers, follows the right chain and keeps up with the node; opens its pages for what BTCortex's explorer shows                                                                                                                |
| **Your own devices reaching BTCortex's Electrum server** | An onion service of BTCortex's tor (**Electrum servers → Access from other devices**)                                             | Wallets on phones and other computers use your node's Electrum server over Tor                                                                                                                                                                             |

**Remote infrastructure** lists the nodes, services, Electrum servers and explorers above by computer: how each computer is reached (local network, internet or Tor), what the credentials let BTCortex do on each service, and a connection test that times one round trip through the service's own interface (`getnetworkinfo`, LND's state, BTCPay's health and server information).

### Permissions are the services' own

BTCortex holds only what each service gives it: RPC credentials for a node, a macaroon for LND, an API key for BTCPay Server. None of them is an operating-system login, and BTCortex does not assume one: it does not log in to other computers, so it cannot see their disks, logs or processes or manage the programs on them. Each kind of access is described where it is used, and the less powerful option is the one offered (a read-only macaroon, a read-only BTCPay key).

### Bitcoin Core on another computer

- The node must accept RPC connections from this computer: in its `bitcoin.conf`, `rpcbind` on an address this computer can reach and `rpcallowip` for this computer's address or network, and an RPC user and password (`rpcauth` is preferable on the node's side).
- BTCortex tests the connection before saving anything, and checks that the node is on the network you chose.
- The password is kept encrypted with Windows (DPAPI) and never shown again. Cookie files only work for nodes on this computer, so they are refused for remote addresses.
- Plain `http://` is accepted only on the local network: loopback, private IPv4 ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16), link-local addresses, the carrier-grade NAT range 100.64.0.0/10 (which Tailscale uses), IPv6 unique local and link-local addresses, and `.local` names. Elsewhere, use an `https://` address (through a TLS proxy) or a VPN such as WireGuard or Tailscale.
- BTCortex never starts, stops or reconfigures a node on another computer: its configuration file and folders are not on this computer, so configuration and storage changes are not offered.
- BTCortex does not connect wallets to it. Sparrow is connected only to nodes on this computer that use their cookie, an Electrum server is set up only next to its node, and hardware-wallet signing is set up only on nodes BTCortex runs. Connect wallets on the node's own computer, or enter an Electrum server running there by hand.

### Electrum servers on other computers

- BTCortex tests a server before adding it. Over TLS, a certificate that a public authority vouches for is accepted as it is. One that no authority vouches for, such as a self-signed certificate, is shown with its subject, issuer, validity and SHA-256 fingerprint, and is accepted only when you tick that it is your server's: compare the fingerprint with the one shown on the server's own computer before you do.
- The accepted certificate is then pinned: every connection checks it before a request is sent, and a server that presents another certificate is refused and raises a critical alert at once.
- Plain TCP is used only on the local network or with onion addresses through BTCortex's tor.

### LND on another computer

See [`LIGHTNING_INTEGRATIONS.md`](LIGHTNING_INTEGRATIONS.md). The certificate is pinned, so an impostor at the same address is refused before anything is sent; an onion address goes through BTCortex's tor with a stream of its own.

### Reaching BTCortex's services from elsewhere

BTCortex opens no ports on the router or in Windows Firewall. Its Electrum servers listen on this computer only; access from your other devices is through an onion service, which you turn on per server and which only someone who knows its address can use. See [`PRIVACY_AND_TOR.md`](PRIVACY_AND_TOR.md).

## Not built yet

- Managing another machine (installing or updating software there, starting and stopping services, reading its resources or logs, transferring files) over SSH or an agent.
- Wallets on this computer are not configured for Electrum servers on other computers; they use the Electrum server BTCortex runs.
- Controlling BTCortex itself from another device.
- Node packages (Umbrel, Start9, RaspiBlitz, myNode) as such: their Bitcoin Core and LND can be connected as above when they expose them, but BTCortex does not use their own APIs.
