# Installing BTCortex

BTCortex is built for Windows 10 and Windows 11 (64-bit, x64); so far it has been tested on Windows 10 22H2 only (see [`KNOWN_LIMITATIONS.md`](KNOWN_LIMITATIONS.md)). It needs no administrator rights and no other software: everything it uses (Bitcoin Core or Bitcoin Knots, Tor, Fulcrum, Sparrow, Electrum, HWI, Trezor Suite) is downloaded later from the official releases, verified, and installed only when you choose to use it.

## Requirements

| What     | Minimum                                                                                                                                                   |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows  | Windows 10 22H2 or Windows 11 (not tested yet), 64-bit                                                                                                    |
| WebView2 | Microsoft Edge WebView2 Runtime (part of current Windows; the installer fetches it if it is missing)                                                      |
| Disk     | About 125 MB for BTCortex. A Bitcoin node needs much more: BTCortex's set-up plan says how much for your choices (a pruned node fits in a few gigabytes). |
| Memory   | 4 GB; 8 GB or more is comfortable with a node and an Electrum server                                                                                      |
| Internet | For downloading releases and for the node; Tor can be used for the node's connections                                                                     |

## Installing

1. Download `BTCortex_<version>_x64-setup.exe`.
2. Run it. It installs for your Windows user only, into `%LOCALAPPDATA%\Programs\BTCortex`, with a Start menu entry and a desktop shortcut. No administrator prompt appears.
3. Releases are not code-signed yet, so Windows SmartScreen may say that it protected your computer. Choose **More info**, check that the file is the one you downloaded, then **Run anyway**. Signed releases will remove this step (see [`RELEASE_PROCESS.md`](RELEASE_PROCESS.md)).

For managed deployments there is also `BTCortex_<version>_x64_en-US.msi`, which installs for all users into `C:\Program Files\BTCortex` and therefore needs administrator rights. It has not been tested yet.

Silent installation: `BTCortex_<version>_x64-setup.exe /S`.

## First start

While nothing is set up, BTCortex opens a short guide: choose **Let BTCortex recommend** or **Choose every detail**, then **Check this computer**, which looks at Windows, the hardware, Bitcoin software already installed, the usual ports and what the network allows, and changes nothing. The guide then recommends a set-up (or offers the node already on this computer) and shows the full plan before anything is installed. **Skip the guide** opens the **Overview** instead; the guide can be opened again from the search (`Ctrl+K`). Nothing is installed or changed until you ask:

- **Bitcoin nodes → Set up Bitcoin Core** proposes a plan for this computer (where the data goes, pruning if the disk is small, memory for the cache, the network) and carries it out after one confirmation: verified download, configuration and first start.
- Bitcoin Core already on this computer is found by itself and connected with one click; BTCortex never changes or starts a node it did not set up.
- Other pages (Electrum servers, Hardware wallets, Tor & Privacy, Lightning) work the same way: a plan or an explanation first, then one action.

## Where BTCortex keeps things

| Location                                   | Content                                                                                            |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `%LOCALAPPDATA%\Programs\BTCortex`         | The program                                                                                        |
| `%LOCALAPPDATA%\BTCortex`                  | BTCortex's data: its database, logs, installed software, node data it created, channel backups     |
| `%LOCALAPPDATA%\BTCortex\nodes`            | Data folders of nodes BTCortex set up (unless you chose another folder in the plan)                |
| `%LOCALAPPDATA%\BTCortex\electrum-wallets` | Wallets made or opened in the Electrum copy BTCortex installed; they are not in BTCortex's backups |
| `%LOCALAPPDATA%\com.btcortex.desktop`      | The window's own cache (WebView2)                                                                  |

Bitcoin Core, Sparrow, Electrum and LND that were already on the computer keep their own folders (`%APPDATA%\Bitcoin`, `%APPDATA%\Sparrow`, `%APPDATA%\Electrum`, `%LOCALAPPDATA%\Lnd`); BTCortex reads them but does not move them.

## Updating

Install the new version over the old one; your data stays where it is, and its database is brought up to date when the new version first starts. (Tested from an earlier build of the same version number.) Components BTCortex installed are updated one verified version at a time, from **Installed software** (Bitcoin Core, Bitcoin Knots, Sparrow, Tor and HWI) or **Updates** (also Fulcrum and Electrum); each version keeps its own folder, so an update never touches the version a node is running.

## Uninstalling

Use **Settings → Apps** in Windows (or `uninstall.exe` in the program folder). The uninstaller removes the program, its shortcuts and its uninstall entry. It never deletes BTCortex's data, node data, blockchain data, wallets or backups. Its optional **Delete the application data** box removes only the window's cache.

Before uninstalling, stop the nodes BTCortex manages from their pages: quitting BTCortex stops only the nodes that are not set to keep running, and a node that keeps running keeps its Electrum server and tor running too. To remove BTCortex's data as well, check that no `bitcoind`, Fulcrum or `tor` started from `%LOCALAPPDATA%\BTCortex` is still running, then delete that folder yourself — but first move anything you want to keep: the node data folders in `nodes` (they hold the nodes' wallets as well as their blocks), the wallets of the Electrum copy BTCortex installed in `electrum-wallets`, and the channel backups in `backups`. BTCortex's own backups are never in this folder: they are where you chose to keep them.
