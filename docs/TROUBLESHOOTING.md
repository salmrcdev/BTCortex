# Troubleshooting

Every error in BTCortex says what happened, which component is affected, whether your data is at risk, the likely cause and what you can do. This page collects the common cases. When something is not covered here, **Logs & diagnostics** shows what each component wrote, and **Create a diagnostic bundle** gathers it, redacted, for support.

## Installing and starting BTCortex

| Symptom                                             | What to do                                                                                                                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Windows SmartScreen says it protected your computer | Releases are not code-signed yet. Choose **More info → Run anyway** after checking that the installer is the one you downloaded.                                                     |
| The window stays blank                              | The Microsoft Edge WebView2 Runtime is missing or damaged. Install or repair it from Microsoft, then start BTCortex again.                                                           |
| "Orchestrator: not connected" in the status bar     | The background program stopped. BTCortex restarts it automatically a few times; if it gives up, the shell log (`%LOCALAPPDATA%\BTCortex\logs\shell.log`) says why. Restart BTCortex. |
| "BTCortex is already running"                       | A second copy was started; the first window comes to the front. If no window is visible, end `btcortex.exe` in Task Manager and start again.                                         |
| "This database was written by a newer BTCortex"     | You went back to an older version. BTCortex refuses to downgrade its database; install the newer version again.                                                                      |

## Bitcoin nodes

| Symptom                                                 | What to do                                                                                                                                                                                                                                                     |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The node does not start                                 | The node's page shows Bitcoin Core's last console lines. Common causes: another Bitcoin Core already uses the same data folder (close it), the disk is full, or a setting in `bitcoin.conf` is wrong (fix it in **Configuration**, which checks every option). |
| "No free port" when setting up                          | Every port BTCortex tried for the node's RPC interface is in use. Close the program using them or restart Windows, then try again.                                                                                                                             |
| The node is "not answering"                             | It may still be starting (loading the block index can take minutes on a hard disk) or it stopped. BTCortex keeps asking with growing pauses; check the node's log under **Logs & diagnostics**.                                                                |
| "Access refused" for a node                             | The cookie changed (the node restarted from another program) or the RPC password is wrong. For a node on another computer, remove it and connect it again with the right password.                                                                             |
| "The node runs on another network"                      | The node's chain does not match the network chosen for it. Connect it again choosing the network it actually uses.                                                                                                                                             |
| Bitcoin Core found on this computer cannot be connected | If it runs in its own window, open **Settings › Options** in Bitcoin Core and tick **Enable RPC server**, then restart it. If it is not running, start it yourself: BTCortex never starts a node it did not set up.                                            |
| Synchronisation is slow                                 | The first synchronisation verifies every block and takes hours to days, longest on a hard disk. The estimate is only an estimate. More memory for the cache (`dbcache`) helps; a hard disk is the usual bottleneck.                                            |
| "Not enough space"                                      | Free space on the volume, or switch the node to pruning in **Storage**. Bitcoin Core stops by itself below 50 MiB free.                                                                                                                                        |

## Tor

| Symptom                                       | What to do                                                                                                                                                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tor stays at a low bootstrap percentage       | Something blocks connections to the Tor network (a firewall or the network itself), or the computer's clock is wrong: **Tor & Privacy** warns when tor reports a clock skew. Set Windows to synchronise its clock. |
| A node set to "only through Tor" has no peers | It waits for tor. Once tor is connected, peers arrive over a few minutes; the node's **Network & peers** tab shows them.                                                                                           |

## Electrum servers

The Electrum servers page always says what a server is waiting for:

| Waiting for                          | Meaning                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| The node to start / to answer        | Fulcrum starts with its node. Start the node.                                                    |
| The node to catch up                 | Fulcrum indexes only a synchronised node.                                                        |
| Bitcoin Core's transaction index     | Building the index takes hours on mainnet; the progress is shown.                                |
| The transaction index is off         | The node's configuration no longer turns it on. Set it up again, or switch it on in **Storage**. |
| The node no longer keeps every block | A pruned node cannot have an Electrum server.                                                    |

A wallet that cannot connect: check that it uses the address and port the page shows (only programs on this computer can reach the server unless access from other devices is on).

## Lightning

| Error                                         | What to do                                                                                                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "Not answering"                               | LND is not running or listens elsewhere: check `restlisten` in `lnd.conf` (8080 by default) and that `norest` is not set.                                                      |
| "Access refused" — different certificate      | LND created a new `tls.cert` (after it was deleted, or with `tlsautorefresh` when its addresses changed). Remove the connection and connect again with the current `tls.cert`. |
| "Access refused" — macaroon rejected          | The macaroon belongs to another node, or LND's macaroons were recreated. Connect again with the current `readonly.macaroon`.                                                   |
| "Wallet locked"                               | Unlock LND with `lncli unlock` or the tool you use for LND. BTCortex never asks for the wallet password.                                                                       |
| "Port 10009" when using an lndconnect address | The address names LND's gRPC port. BTCortex uses REST: replace the port with LND's REST port (8080 unless `restlisten` says otherwise).                                        |
| An onion address cannot be reached            | BTCortex's tor must be running (**Tor & Privacy**). Onion services can take a minute to answer.                                                                                |

## Hardware wallets

| Symptom                                                | What to do                                                                                                                                                                             |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The device is not listed                               | Use a data cable (some cables only charge), unlock the device, and close other programs that hold it (Trezor Suite, Sparrow). Windows' problem code is shown when a driver is missing. |
| "Firmware update mode"                                 | The device is in its bootloader; restart it normally, or finish the update in Trezor Suite.                                                                                            |
| Trezor Safe 7 or Ledger Nano Gen5 not supported by HWI | HWI does not support them yet; use Sparrow, which BTCortex connects to the node.                                                                                                       |
| The address on the device differs                      | Do not use it. BTCortex refuses an address the device does not confirm; check that the wallet on the node belongs to this device.                                                      |

## Installed software

| Error                             | What to do                                                                                                                                               |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Rejected" during an installation | A signature, checksum or code signature did not verify. Nothing was installed. Try again later; if it persists, the release may have been tampered with. |
| "Download corrupted"              | The file changed in transit; the download is discarded. Try again.                                                                                       |
| "In use"                          | A node or a running program uses that version; move the node to another version or close the program first.                                              |
| Files changed after installation  | **Check files** found differences from what was verified: reinstall that version.                                                                        |

## Getting help

**Logs & diagnostics → Create a diagnostic bundle** writes a ZIP file into `%LOCALAPPDATA%\BTCortex\exports` (the five newest are kept) with recent logs, BTCortex's version and the state of nodes, jobs and tor. Passwords, cookies, macaroons, tokens and keys are removed, your Windows user folder is replaced by a placeholder, and transaction and block identifiers in Bitcoin Core's log are hidden, because they could link transactions to you. You can open the ZIP and check it before sharing it.
