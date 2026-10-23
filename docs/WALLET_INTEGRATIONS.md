# Wallet integrations

How BTCortex connects wallets and signing devices to the user's own node, what it configures, and what it never does. The research behind it is [`research/notes/wallets-hardware.md`](research/notes/wallets-hardware.md); what is implemented today is tracked in [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md).

## Principles

- Recovery phrases (seeds) are never asked for, read, stored or extracted. A hardware wallet only ever shows or asks for its recovery phrase on its own screen.
- Nothing is signed without an explicit request in BTCortex, and the device shows the transaction and asks for confirmation itself. Building a transaction, signing it and broadcasting it are three separate steps; the last two each ask first.
- Software that talks to a device is installed only from verified releases, and BTCortex prefers mature wallet software (Sparrow, HWI, Bitcoin Core) to driving devices itself.
- Wallet files of other applications are never opened or changed.

## Sparrow

Connected to a node with one action on the node's page: the portable release verified against Craig Raw's pinned key, cookie authentication only (Sparrow would store a password in plain text), settings changed only while Sparrow is closed and backed up first. Sparrow then works with every hardware wallet it supports through its own library, including the Trezor Safe 7. Details: [`ARCHITECTURE.md`](ARCHITECTURE.md#sparrow-integration).

## Hardware wallets

The **Hardware wallets** page brings a signing device to the user's node in four steps, shown as such: install HWI, set up the node, connect and unlock the device, create the wallet.

### Recognising devices

BTCortex reads Windows' device list (Win32_PnPEntity) and recognises signing devices from their USB vendor and product identifiers, the same ones HWI 3.2.0 uses. Reading the list never opens a device, so it cannot disturb Trezor Suite, Sparrow or HWI while they use it. It shows:

- the vendor, and the model where the identity tells it (every recent Trezor shares one identity; HWI names the model);
- whether the device is in firmware-update (bootloader) mode;
- whether Windows has a working driver, with Windows' problem code otherwise. Current hardware wallets need no driver of their own on Windows 10 and 11;
- a USB serial adapter of the kind a Blockstream Jade uses, only as "possibly a Jade", because many other devices use the same adapters.

**Identify with HWI** asks HWI for the model and, once the device is unlocked, its master key fingerprint. HWI opens each device briefly, so this happens only on request.

### HWI

HWI (Hardware Wallet Interface) is Bitcoin Core's reference tool for signing devices. BTCortex installs its portable release only after checking Ava Chow's clear signature on `SHA256SUMS.txt.asc` with the pinned key, the archive's checksum, and the checksums of `hwi.exe` and `hwi-qt.exe` inside the archive, which the signed file also lists; `hwi.exe --version` must run before the installation is used. BTCortex's own HWI client offers only listing devices, reading public descriptors, showing an address and signing a PSBT; device set-up, wiping, restoring, backups, PIN and passphrase handling are deliberately not offered.

HWI is in maintenance mode upstream and does not support the Trezor Safe 7 (Trezor's encrypted host protocol) or the Ledger Nano Gen5. Those devices work through Sparrow.

### A watch-only wallet on the node

For nodes BTCortex set up, **Let this node use hardware wallets** points Bitcoin Core at the verified HWI (`signer="<path>\hwi.exe"`, quoted so that a user name with spaces works) and restarts the node. Bitcoin Core then:

- finds the connected device (`enumeratesigners`);
- creates a watch-only wallet from the device's public descriptors (`createwallet` with `external_signer`): no private key leaves the device. Bitcoin Core works with one device at a time;
- shows a receiving address on the device (`walletdisplayaddress`) and refuses the address if the device echoes a different one; BTCortex asks the user to check every new address there before sharing it;
- asks the device to sign (`walletprocesspsbt`), which the device confirms on its own screen.

A new wallet sees payments from its creation onwards. On a pruned node, earlier payments to the device cannot be found by rescanning, because the old blocks are gone.

### Sending

1. **Review**: address, amount and fee rate (proposed from the node's own estimate for about six blocks) become an unsigned PSBT built by the node; BTCortex shows every output, which one is change, the inputs and the fee. Nothing reaches the device.
2. **Sign**: after a confirmation that explains what the device will show, the PSBT goes to the device through Bitcoin Core and HWI. The device shows the transaction; the user confirms there.
3. **Send**: after a second confirmation, the node broadcasts the signed transaction. If the node routes through Tor with private broadcasting, it leaves that way.

### Devices that sign without a cable

- **QR codes**: a PSBT is shown as Uniform Resources (`ur:crypto-psbt`, BCR-2020-005), in one code when it fits and otherwise as an animated sequence of fountain-coded parts, which Passport, Keystone, SeedSigner, Krux and Jade read; a device that misses a few frames still completes it from the extra parts. The device's signed answer is read with the camera (codes read until they make up the whole PSBT, with progress shown); a plain base64 PSBT in a single code is accepted too. The codes are made and read by the orchestrator; the interface only draws them and samples the camera.
- **Files**: PSBTs can be saved to and loaded from files, for example on a microSD card: `.psbt` files hold the PSBT in binary, as COLDCARD and other devices expect; `.txt` files hold base64.

A loaded or scanned PSBT is shown the same way before it is signed, finalised or sent.

### Your own Electrum server

Wallets that speak the Electrum protocol can use the user's own node through the Electrum server BTCortex runs next to it (Fulcrum; see [`ARCHITECTURE.md`](ARCHITECTURE.md#electrum-servers)). The Electrum servers page shows, once indexing is finished, the values to enter:

| Wallet                 | Where                                                                       | Value                                                             |
| ---------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Sparrow                | Preferences → Server → Private Electrum                                     | URL `127.0.0.1`, port `50001`, SSL off                            |
| Trezor Suite (desktop) | Settings → Networks → sliders icon next to Bitcoin → Custom Electrum server | `127.0.0.1:50001:t`                                               |
| Electrum               | Network → Server, “Select server automatically” off                         | `127.0.0.1:50001:t` (or `--oneserver --server 127.0.0.1:50001:t`) |

The port shown is the one BTCortex chose for that server (50001 for mainnet when it is free). Trezor's guide gives the `host:port:t` form and supports custom servers in the desktop app only. The connection is plain TCP, which is safe because it never leaves the computer. Phones and other computers cannot reach the server this way; they can through its onion address once **Access from other devices** is turned on (see [`PRIVACY_AND_TOR.md`](PRIVACY_AND_TOR.md)).

### Electrum

Electrum cannot use Bitcoin Core directly; it needs an Electrum server. Once a node's Electrum server is ready, its page offers **Open Electrum with this server**:

- An Electrum installed on this computer with its own installer (found through its uninstall key) is used as it is, with the user's wallets; BTCortex says when a newer release exists, as Electrum's updates are security releases. It is never replaced, because a newer version may upgrade wallet files the older one then cannot open.
- Otherwise BTCortex installs the standalone `electrum-<version>.exe` (no administrator rights), kept only when a signature from ThomasV's or SomberNight's pinned key verifies and Electrum Technologies GmbH's Windows signature is valid. BTCortex's copy keeps its wallets in a folder of its own (`electrum-wallets` in BTCortex's data folder, given with `--dir`), never in `%APPDATA%\Electrum`: that folder may hold the wallets of a standalone Electrum BTCortex cannot see, which a newer Electrum would upgrade beyond that Electrum's reach. The page says so when such wallets exist. BTCortex's backups do not include the wallets in `electrum-wallets`: back them up from Electrum, and keep their seeds; the Storage page lists the folder, and the Backups page names it among what is not backed up.
- Electrum starts on the node's network with `--oneserver --server 127.0.0.1:<port>:t`. Command-line options apply to that session only and are not written to Electrum's settings (checked: its `config` file stays without them), so nothing of Electrum's is changed.
- Electrum 4.9 is expected to require Electrum protocol 1.7, which Fulcrum 2.1 does not offer, so BTCortex installs the 4.8 series only for now; a newer release is shown in the update centre with that reason, not offered as an update.

### Trezor

- **Trezor Suite**, Trezor's own application, is where a new Trezor is set up and firmware is updated, including the Bitcoin-only firmware, and where the Safe 7 is paired. BTCortex installs it for the current Windows user without administrator rights after checking two signatures: the detached OpenPGP signature on the installer from the SatoshiLabs 2021 Signing Key (`EB48 3B26 B078 A4AA 1B6F 425E E21B 6950 A2EC B65C`, pinned) and the installer's valid Windows signature from Trezor Company s.r.o. or SatoshiLabs, s.r.o. Suite updates itself afterwards. BTCortex never enables or connects to Suite's experimental MCP server.
- While Trezor Suite is open it holds the Trezor's USB interface; BTCortex says so, because the node and Sparrow can reach the device only once Suite is closed.
- The standalone **Trezor Bridge** is deprecated by Trezor. BTCortex detects it (its program folder, its process or its port 21325) and suggests removing it; it does not remove it itself.

### Compatibility at a glance

| Device                                 | With the node in BTCortex                           | Notes                                                           |
| -------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------- |
| Trezor Model One, Model T, Safe 3, 5   | Watch-only wallet, addresses on the device, signing | Set-up and firmware in Trezor Suite                             |
| Trezor Safe 7                          | Through Sparrow                                     | Not in HWI yet                                                  |
| Ledger Nano S Plus, Nano X, Stax, Flex | Watch-only wallet, addresses on the device, signing | Bitcoin app open; Ledger's own application cannot use your node |
| BitBox02                               | Watch-only wallet, addresses on the device, signing | Pair once in the BitBoxApp                                      |
| COLDCARD                               | With a cable, or PSBT files on microSD              |                                                                 |
| Blockstream Jade                       | Watch-only wallet, addresses on the device, signing | Unlocking may contact Blockstream's PIN server                  |
| Passport, Keystone, Krux               | Animated QR codes, or PSBT files on microSD         |                                                                 |
| SeedSigner                             | Animated QR codes                                   | It reads no files                                               |

The path through Bitcoin Core is tested end to end with a stand-in for HWI that simulates a device, and the real HWI is tested without a device: Bitcoin Core runs it from a quoted path with spaces and it lists devices. No physical device has been used in the tests yet.
