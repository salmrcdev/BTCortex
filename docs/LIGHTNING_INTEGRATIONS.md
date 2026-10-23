# Lightning integrations

How BTCortex connects to Lightning nodes, what it reads, what it keeps, and what it never does. The research behind it is [`research/notes/lightning.md`](research/notes/lightning.md); what is implemented today is tracked in [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md).

## Principles

- BTCortex reads. It never pays, opens, closes or rebalances channels, changes fees or moves funds. Operations that would need such permissions are not offered.
- The read-only macaroon is enough and is recommended. A macaroon that can move funds is refused until the user explicitly accepts it, after BTCortex has said why the read-only one is enough, and the node then carries a standing warning.
- Macaroons live only in the vault, encrypted with Windows DPAPI by the native shell. They never reach the interface, the settings, the logs or diagnostic bundles.
- LND's certificate is pinned by its SHA-256 fingerprint. A node that presents any other certificate is refused before anything is sent to it, the macaroon included.
- Secrets in LND's answers, such as payment preimages and invoice secrets, are dropped by the orchestrator and never reach the interface.
- The wallet password and the seed are never asked for. A locked wallet is reported, and the user unlocks it with LND's own tools.

## LND

[LND](https://github.com/lightningnetwork/lnd) is the Lightning implementation with official Windows builds, so it is the first BTCortex supports. BTCortex speaks its REST interface (JSON over HTTPS on port 8080 by default), on this computer or another.

### Connecting

The **Lightning** page offers three ways:

1. **LND on this computer.** BTCortex looks where LND keeps its files on Windows, `%LOCALAPPDATA%\Lnd`, and reads `lnd.conf` for the network (`bitcoin.mainnet`, `bitcoin.testnet`, `bitcoin.signet`, `bitcoin.regtest` and so on), the REST address (`restlisten`, a wildcard listener being reached on `127.0.0.1`), a disabled REST interface (`norest`) and moved files (`datadir`, `tlscertpath`, `*macaroonpath`). It shows the macaroons it found and what each allows, and connects with `readonly.macaroon` in one click. It only reads LND's files and never changes them.
2. **Address and files.** A REST address with LND's `tls.cert` and a macaroon file copied from the node. The interface only learns the file paths the user picked in Windows' Open dialog; the orchestrator reads the files.
3. **lndconnect address.** The `lndconnect://host:port?cert=…&macaroon=…` address node packages show for wallets. An address that names port 10009, LND's gRPC port, is refused with an explanation, because BTCortex uses REST.

Before a connection is saved, BTCortex checks that the node answers with the given certificate and macaroon (`/v1/state`, then `/v1/getinfo`), and refuses a second connection to the same node.

An onion address is reached through BTCortex's own tor, on its application SOCKS port, with a SOCKS username per connection so that tor gives each its own circuits (stream isolation). Host names are handed to tor unresolved.

### What a macaroon allows

LND's macaroons carry their permissions in their identifier. BTCortex reads them without asking the node and classifies them:

| Access         | Means                                                         | LND's file          |
| -------------- | ------------------------------------------------------------- | ------------------- |
| Read-only      | Reads only. All BTCortex needs.                               | `readonly.macaroon` |
| Invoices       | Can also create invoices and addresses, but not spend.        | `invoice.macaroon`  |
| Can move funds | Can spend on-chain and over Lightning, and change the node.   | `admin.macaroon`    |
| Custom         | Some other set of permissions that writes (a baked macaroon). | —                   |

A `time-before` caveat is shown as the macaroon's expiry, with a warning a week before.

### What BTCortex shows

For each connected node, refreshed every 30 seconds while the page is open, and with its state checked in the background every 30 seconds:

- **State**: ready, catching up (with the chain or the network graph), wallet locked, not answering, access refused (macaroon or certificate) or error, each with an explanation and what to do.
- **Overview**: alias and colour, public key, LND version, block height, synchronisation, announced addresses, on-chain balance (with the amount LND keeps back for anchor-channel fees), what the node can send and receive over its channels, routing fees over 30 days, the share of channel funds on each side, watchtower client state and the size of the network graph.
- **Channels**: per channel the peer (with its alias from the graph), state, capacity, how the funds are split between the two sides, this node's fee policy, pending HTLCs, who opened it and its uptime; and channels that are opening (confirmations to go), closing, or force-closing (funds waiting for the time lock, and when they become spendable).
- **Peers**: address, direction, ping, amounts sent and received, disconnections.
- **Payments**: recent payments (status, amount, fee, the node paid, hops) and recent invoices (description, state, amount, paid, expiry).
- **Routing**: fees earned over the last day, week and month as LND sums them, forwards and the amount forwarded over 30 days, and recent forwards with the peers on each side.
- **Things to look at**: not synchronised, inactive channels, channels that can hardly send or receive (under a tenth of their capacity on one side), force-closed channels, a macaroon that can move funds, a macaroon about to expire, and channels without a current backup. Parts the macaroon does not allow BTCortex to read are listed as such.

### Channel backups

**Save channel backup** exports LND's static channel backup (`/v1/channels/backup`, allowed by the read-only macaroon) into `%LOCALAPPDATA%\BTCortex\backups\lightning\<connection>\channel-backup-<time>.backup`, the same multi-channel format as LND's `channel.backup` file. LND encrypts it with a key derived from the node's seed: with that seed it lets the funds in the channels be recovered after a disk failure (`lncli restorechanbackup --multi_file`), and it is useless to anyone without it. Saved backups are never deleted by BTCortex, not even when a connection is removed. BTCortex warns while the channels have changed since the last backup.

### Installing LND

BTCortex's installer for LND verifies a release the way LND's own `scripts/verify-install.sh` does: the Windows ZIP's hash must be listed in `manifest-v<version>.txt`, and that manifest must carry valid signatures from at least five of the sixteen release keys the script lists (pinned in [`packages/integrations/lnd/src/signing-keys.generated.ts`](../packages/integrations/lnd/src/signing-keys.generated.ts), refreshed by `npm run update-keys --workspace @btcortex/integration-lnd`), each key counted once. LND's binaries are reproducible but not Authenticode-signed, so Windows' signature check is recorded only. `lnd.exe --version` must report the expected version before the installation is used. The application does not yet set up and run LND for the user: creating an LND wallet means showing its seed, which BTCortex will only do through LND's own tools. Today the installer is used for the integration tests.

### Testing

`tests/integration/lightning.test.ts` runs three LND 0.21.4 nodes (one laid out as a local installation in `<LOCALAPPDATA>\Lnd`) on a regtest Bitcoin Core: alice pays carol through bob, bob pays alice, and BTCortex connects to all three (local detection, files, lndconnect), reads bob's routing with fees and forwards, checks that no preimage reaches the dashboard, saves bob's channel backup and has LND verify it, refuses wrong macaroons and certificates, and reports a node that stopped. Throwaway nodes use `--noseedbackup`, which is acceptable for a test wallet and nothing else.

## Other implementations

| Project        | Windows                                                                    | How BTCortex could support it                                   |
| -------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Core Lightning | No Windows build (Ubuntu and Fedora binaries, macOS from source)           | Remote connection through clnrest with a rune (not implemented) |
| Eclair         | A JVM application targeting Java 21; Windows is not documented             | Its HTTP API with a password (not implemented)                  |
| LDK Node       | A library, not a daemon                                                    | Through applications built on it                                |
| phoenixd       | Linux and macOS builds and a JVM build; Windows through WSL per its README | Its HTTP API with a password (not implemented)                  |

Management tools (Ride The Lightning, ThunderHub, LNbits, LNDg, Lightning Terminal) and liquidity services (Loop, Pool, Boltz) are researched in [`research/notes/lightning.md`](research/notes/lightning.md); BTCortex does not install or launch them yet.
