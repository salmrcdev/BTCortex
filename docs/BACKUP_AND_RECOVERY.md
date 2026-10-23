# Backup and recovery

What needs backing up in a self-hosted Bitcoin setup, what BTCortex's **Backups** page backs up, how its backups are protected and checked, and how to recover. The implementation is described in [`ARCHITECTURE.md`](ARCHITECTURE.md#backups).

## First: what recovers funds

**Funds are recovered from seeds (recovery phrases), wallet backups and Lightning channel backups.** A backup of settings or configuration makes things work again, but never recovers funds on its own. BTCortex never asks for, sees or stores a seed, so it cannot back seeds up: write them down and keep them as their wallet or hardware wallet tells you.

## What is what

| Kind                    | Examples                                                                                                      | Backed up by BTCortex                       | If lost                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------- |
| **Configuration**       | BTCortex's settings and node profiles; each node's `bitcoin.conf`                                             | Yes                                         | Things must be set up again                             |
| **Wallets**             | Bitcoin Core wallets (`wallet.dat`)                                                                           | Yes, encrypted only, as consistent copies   | Funds are lost unless a seed or another backup exists   |
| **Electrum wallets**    | Wallets made or opened in the Electrum copy BTCortex installed, in `%LOCALAPPDATA%\BTCortex\electrum-wallets` | **No** — back them up from Electrum         | Funds are lost unless a seed or another backup exists   |
| **Descriptors**         | A wallet's public descriptors                                                                                 | Yes                                         | Watching the wallet needs them again; they cannot spend |
| **Channel backups**     | LND's static channel backup                                                                                   | Yes (saved from the Lightning page as well) | Channel funds may be lost if the LND node's disk fails  |
| **Credentials**         | RPC passwords of remote nodes, LND macaroons, onion-service keys                                              | Yes, encrypted only                         | Connections must be made again; onion addresses change  |
| **Seeds**               | Recovery phrases of wallets and hardware wallets                                                              | **Never** — BTCortex never sees them        | Funds are lost                                          |
| **Blockchain data**     | Blocks, chain state                                                                                           | No — downloaded again and verified          | A new synchronisation (hours to days)                   |
| **Rebuildable indexes** | Transaction index, block filters, Electrum server indexes                                                     | No — rebuilt from the blocks                | Rebuilding takes hours                                  |

## Making backups

1. Open **Backups** and **choose a folder**, ideally on another disk, a USB drive or a network folder: a backup on the same disk as BTCortex's data is lost with that disk, and the page warns when that is the case. BTCortex's own data folder is refused.
2. In **Back up now**, choose the items. Everything that is available and holds no secrets is chosen by default.
3. To include wallets and credentials, enter a **passphrase** (at least 12 characters) twice. The whole backup is then encrypted. Without the passphrase an encrypted backup cannot be read — not by you, not by BTCortex, not by anyone — so keep it somewhere safe and separate from the backup.
4. **Back up** runs in the background: the items are copied, the backup is written, then checked against its manifest. Items that could not be backed up are listed with the reason (for example a wallet of a node that is not running).

### How items are copied

- **Wallets** are copied by Bitcoin Core itself (`backupwallet`), which makes a consistent copy while the node runs; BTCortex never copies a wallet file that is in use. Only wallets loaded in a running node on this computer can be copied; wallets of nodes on other computers are backed up there.
- **bitcoin.conf**: in an unencrypted backup, passwords and `rpcauth` values are left out.
- **Descriptors** come from `listdescriptors` without private keys.
- **Channel backups** are exported fresh from LND at backup time (`/v1/channels/backup`, allowed by the read-only macaroon).
- **Credentials** are taken from BTCortex's DPAPI vault, where Windows protects them for this user on this computer only.

## Automatic backups

Under **Where and when**, choose how often (every 6 or 12 hours, daily, weekly) and how many backups to keep. Automatic backups run while BTCortex is open, when the last backup is older than the interval. One that fails, or a backup that is overdue, raises a warning in Monitoring, shown in the window and, with Monitoring's default notification setting (warnings and critical alerts), as a Windows notification; with "critical alerts only" it appears in the window only.

- To make automatic backups encrypted (and include wallets and credentials), give BTCortex a passphrase to keep. It is kept in the DPAPI vault: anyone who can use your Windows account can therefore read those backups, which is the trade-off for not typing the passphrase each time. **Forget the passphrase** removes it; automatic backups then leave wallets and credentials out.
- **Retention**: after a successful backup, the oldest BTCortex backups in the folder beyond the number to keep are deleted, except one that holds the newest copy of a wallet, a channel backup or the credentials: automatic backups without a passphrase leave wallets out, so a run of them never pushes the only wallet copy away. Only folders with a valid BTCortex manifest are ever counted or deleted.

## What a backup looks like

A folder `BTCortex-backup-<date and time>` containing:

- `manifest.json` — what is inside: each item with its kind, where it came from, and for every file its size and SHA-256, both of the stored bytes and of the original contents; for encrypted backups, the key-derivation parameters;
- `README.txt` — the same explanation in plain text, with how to restore by hand;
- `items\` — one folder per item.

Encrypted backups use AES-256-GCM for every file (a fresh nonce per file), under a key derived from the passphrase with scrypt (N = 2^17, r = 8, p = 1). A short known text encrypted with the same key lets BTCortex tell a wrong passphrase from a damaged file. The manifest itself is not encrypted: it shows item titles (such as wallet names) but no contents.

## Verifying

**Verify** checks every file of a backup against its manifest. Without the passphrase it checks the stored bytes; with it, it also decrypts each file and checks its contents. Every new backup is verified as soon as it is written. Verify older backups from time to time, especially on removable drives.

## Restoring

**Restore…** first shows what the backup holds and, item by item, what restoring would do. Nothing changes until you choose items and confirm.

- **A managed node's bitcoin.conf** is restored through the same checks as the configuration editor: settings BTCortex relies on cannot change, and the current file is kept as a backup. Settings that need confirmation (pruning, network exposure, commands run on events) stop the restore and are listed; **Review these settings and restore again** restores the file once you confirm them. Options that run commands are never restored from an unencrypted backup, because anyone who could write to its folder could have added them. From a backup without passwords, the passwords in the current file are kept where they match. Restart the node to use it.
- **A wallet** is loaded into a running node on this computer with Bitcoin Core's `restorewallet`, under its own name or `<name>-restored-<date>` if the name is taken. Bitcoin Core then looks through the chain for the wallet's transactions; this can take a long time and needs the blocks since the wallet was made, which a pruned node may no longer have.
- **Other items** are for restoring by hand, as the preview explains:
  - BTCortex's settings and node profiles (JSON) show how everything was set up; without a passphrase, the onion addresses of the Electrum servers are left out, because anyone who has one can use the server;
  - descriptors can be imported into a watch-only wallet (Sparrow, or `importdescriptors`);
  - a channel backup is used after restoring LND from its seed: `lncli restorechanbackup --multi_file <file>`; LND then asks the peers to close the channels and the funds return on-chain;
  - credentials (JSON) hold the passwords, macaroons and onion keys for setting things up again.

The results of the last restore are shown under the backups.

## Recovering on a new computer

1. Install BTCortex ([`INSTALLATION.md`](INSTALLATION.md)) and set up or connect your nodes again.
2. Copy the backup folder to the new computer and choose its parent as the backup folder.
3. Restore wallets into a running node. Restore `bitcoin.conf` for nodes BTCortex set up, or use it as a reference.
4. Reconnect Lightning nodes and remote nodes with the credentials from the backup; restore an LND node from its seed and the channel backup with LND's own tools.

Practise this once with a test backup and regtest or signet before you need it.

## Other copies BTCortex keeps by itself

- Every change to a managed node's `bitcoin.conf` keeps the previous file next to it (`bitcoin.conf.btcortex-<time>.bak`, the ten newest).
- Before changing Sparrow's settings, BTCortex backs up its configuration file next to it.
- Channel backups saved from the Lightning page go to `%LOCALAPPDATA%\BTCortex\backups\lightning` and are never deleted by BTCortex.

## Not built yet

- Restoring BTCortex's own settings and node profiles automatically.
- Backups to cloud services; BTCortex writes to folders, so a synchronised folder can be chosen.
