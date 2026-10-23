# Building BTCortex for Windows

## Requirements

The prerequisites in [`DEVELOPMENT.md`](DEVELOPMENT.md): Node.js 26, Rust stable (MSVC), the Visual Studio C++ workload with the Windows 10/11 SDK, and the WebView2 runtime.

## Build

```bash
npm install
npm run build
```

`npm run build` does the following:

1. Bundles the orchestrator with esbuild and builds the Node.js single executable `btcortex-orchestrator.exe`. OpenPGP.js stays out of the bundle (it is LGPL-3.0): the bundle loads `openpgp\openpgp.cjs` from beside the executable, and the build writes that file, OpenPGP.js's `LICENSE` and a `NOTICE.txt` there.
2. Smoke-tests that executable (start, RPC round trip, database, clean shutdown), with OpenPGP.js loaded from its own file.
3. Copies it to `apps/desktop/src-tauri/binaries/btcortex-orchestrator-x86_64-pc-windows-msvc.exe`, where Tauri expects sidecars, and OpenPGP.js to `apps/desktop/src-tauri/resources/openpgp`, which `tauri.conf.json` lists as resources installed in `openpgp\`.
4. Builds the React interface with Vite.
5. Builds the Tauri shell in release mode and produces the NSIS (`*-setup.exe`) and MSI installers under `apps/desktop/src-tauri/target/release/bundle/`.

## Installer behaviour

- NSIS installs per user (`installMode: currentUser`): no administrator rights. The program goes to `%LOCALAPPDATA%\Programs\BTCortex`, Windows' folder for per-user programs, with Start menu and desktop shortcuts and an uninstall entry under `HKCU`.
- BTCortex's data (database, logs, managed node data, installed software) lives in `%LOCALAPPDATA%\BTCortex`, never in the program folder. Tauri's template would install per-user programs into `%LOCALAPPDATA%\BTCortex` itself, the same folder as the data, so BTCortex builds with its own copy of the template, [`apps/desktop/src-tauri/windows/installer.nsi`](../apps/desktop/src-tauri/windows/installer.nsi), which differs from Tauri CLI 2.12.3's only in that folder (the change is marked "BTCortex"). When `@tauri-apps/cli` is upgraded, compare the copy with the new version's template and carry the change over.
- WebView2 is installed by the download bootstrapper only if missing.
- Uninstalling removes the program, its shortcuts and its uninstall entry only. BTCortex's data, managed node data, blockchain data and wallets are never deleted by the uninstaller. Its optional "Delete the application data" box (not ticked by default, never in silent mode) removes only the WebView's cache and window state in `%LOCALAPPDATA%\com.btcortex.desktop` and `%APPDATA%\com.btcortex.desktop`.
- The MSI installs for all users into `C:\Program Files\BTCortex` and therefore needs administrator rights; it suits managed deployments.

## Verified on Windows

On Windows 10 22H2 (19045) with WebView2 155, on 23 October 2026:

1. `npm run build` produced `BTCortex_0.1.0_x64-setup.exe` (29.8 MiB) and `BTCortex_0.1.0_x64_en-US.msi` (43.9 MiB); the sidecar's smoke test passed.
2. `BTCortex_0.1.0_x64-setup.exe /S` installed without elevation into `%LOCALAPPDATA%\Programs\BTCortex` (`btcortex.exe`, `btcortex-orchestrator.exe`, `uninstall.exe`), with the shortcuts and the `HKCU` uninstall entry.
3. The installed application started without any development server: the WebView2 window showed the complete interface, the orchestrator ran from the program folder, applied its database migrations in `%LOCALAPPDATA%\BTCortex` and reported itself connected.
4. Closing the window shut the orchestrator down gracefully (exit code 0, logged by both the shell and the orchestrator).
5. `uninstall.exe /S` removed the program folder, the shortcuts and the uninstall entry, and left `%LOCALAPPDATA%\BTCortex` (database and logs) untouched.

6. Upgrade, later the same day: the installer of the 07:22 build (an earlier 0.1.0 with fewer areas) was installed and started on a test data folder (`BTCORTEX_DATA_DIR`), then the 15:47 build's `BTCortex_0.1.0_x64-setup.exe /S` (30.5 MiB) was installed over it without elevation. It replaced `btcortex.exe` and `btcortex-orchestrator.exe`, kept the uninstall entry, and on its first start applied the two newer database migrations to the earlier version's database and showed every current area, loaded from the bundle; `uninstall.exe /S` then removed the program, the shortcuts and the uninstall entry, and kept the data.

7. OpenPGP.js as a file of its own and the licence list, the same evening: the 18:00 build's `BTCortex_0.1.0_x64-setup.exe /S` (30.6 MiB) installed `openpgp\openpgp.cjs`, `openpgp\LICENSE`, `openpgp\NOTICE.txt` and `THIRD_PARTY_LICENCES.txt` beside the executables. Started on a fresh test data folder, the installed orchestrator loaded OpenPGP.js from that file and set up Tor: the Tor Expert Bundle's signed checksums and archive signature were verified against the pinned Tor Browser Developers key (the first download was cut off by the network and the second attempt resumed it). `uninstall.exe /S` then removed the program folder, including `openpgp`, and the uninstall entry, and kept the data.

Not yet tested: the MSI (it needs administrator rights), upgrading between different version numbers, and installing on Windows 11.

## Status

The installers are built and the per-user installer is tested as above. Code signing is not configured: unsigned builds trigger Windows SmartScreen warnings. Before a release, configure signing (signtool or Azure Artifact Signing) for both the shell and the sidecar, because injecting the application into the Node.js runtime invalidates the original Node.js signature.
