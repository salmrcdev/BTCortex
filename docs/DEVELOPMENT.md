# Developing BTCortex

## Prerequisites (Windows 10 or 11, x64)

| Tool                            | Version used                            | Notes                                                                  |
| ------------------------------- | --------------------------------------- | ---------------------------------------------------------------------- |
| Node.js                         | 26.4                                    | Builds the orchestrator single executable (`node --build-sea`)         |
| npm                             | 11.17                                   | Workspaces; install scripts are blocked by default and none are needed |
| Rust                            | 1.99 (stable, `x86_64-pc-windows-msvc`) | Install with rustup                                                    |
| Visual Studio 2026 C++ workload | MSVC 14.51 + Windows SDK 10.0.26100     | "Desktop development with C++"                                         |
| WebView2 Runtime                | Evergreen                               | Present on current Windows 10/11                                       |
| Python                          | 3.x                                     | Only for the ui-ux-pro-max design skill                                |

## First run

```bash
npm install
npx tsx scripts/dev/install-bitcoin-core.ts   # verified Bitcoin Core runtime for integration tests (.test-env/)
npx tsx scripts/dev/install-bitcoin-knots.ts  # verified Bitcoin Knots runtime, for tests/integration/bitcoin-knots.test.ts
npm run dev                                   # builds the orchestrator, starts Vite and the Tauri window
```

Development builds keep their data in `%LOCALAPPDATA%\BTCortex-dev` and log to `…\logs`. Their Windows notifications appear under "Windows PowerShell", because an application that is not installed has no identity of its own registered with Windows.

## Commands

| Command                      | What it does                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `npm run dev`                | Builds the sidecar and runs `tauri dev` (hot reload for the interface; Rust rebuilds on change)              |
| `npm run build:orchestrator` | Bundles the orchestrator, builds the single executable, smoke-tests it and copies it to `src-tauri/binaries` |
| `npm run build`              | Production build of the sidecar and the Windows installers                                                   |
| `npm run typecheck`          | TypeScript in every workspace                                                                                |
| `npm run lint`               | ESLint with `strictTypeChecked` rules                                                                        |
| `npm test`                   | Unit, component and integration tests                                                                        |
| `npm run format`             | Prettier                                                                                                     |
| `npm run research:docs`      | Validates the research records and regenerates the research documents                                        |

After changing orchestrator code while `tauri dev` runs, rebuild the sidecar and touch a Rust file (or restart `npm run dev`) so Tauri copies the new executable.

The logo's source is `apps/desktop/src-tauri/app-icon.png` (1254 × 1254, transparent corners). After changing it, run `npx tauri icon` in `apps/desktop` to regenerate `src-tauri/icons` (window, taskbar, notification area and installer icons; `icon.ico` holds 16 to 256 pixels), delete the `android` and `ios` folders the command adds, and resize it to 96 × 96 for the sidebar's `src/assets/brand/btcortex-icon.png`.

## Conventions

- **Language:** British English for all user-facing text, documentation and comments. Protocol fields, upstream option names and API methods keep their official spelling.
- **Text:** every interface string lives in `apps/desktop/src/i18n/en-GB.ts`.
- **Types:** strict TypeScript (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`). Runtime validation with Zod at every boundary.
- **Errors:** throw `AppFailure` with a complete `AppError` for anything the user may see.
- **No fabricated data:** the interface shows only data from a real source, with its time.
- **Design:** follow `design-system/btcortex/MASTER.md`; interface work uses the ui-ux-pro-max skill, and charts, stat tiles and meters follow the dataviz rules recorded there.
- **New orchestrator methods:** declare them in `packages/contracts/src/methods.ts` with schemas, access and risk, then register a handler.

## Adding a Bitcoin Core option to the editor

Add it to `packages/bitcoin-config/src/options.ts` with its category, type, default, version history and risk. Validation and the editor pick it up from the catalogue.
