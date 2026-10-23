# Testing BTCortex

| Layer                | Tooling                                    | Location                                                             | What is real                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------- | ------------------------------------------ | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit                 | Vitest                                     | `packages/**/src/**/*.test.ts`, `apps/orchestrator/src/**/*.test.ts` | Pure logic; HTTP tests use a local server, not mocks of `fetch`                                                                                                                                                                                                                                                                                                                  |
| Component            | Vitest, Testing Library, jsdom             | `apps/desktop/src/**/*.test.tsx`                                     | Rendering and interaction; the orchestrator is mocked at `callOrchestrator`                                                                                                                                                                                                                                                                                                      |
| Integration          | Vitest                                     | `tests/integration`                                                  | A **real `bitcoind`** (the verified 31.1 runtime) on regtest, started and stopped by BTCortex code; real Tor, Fulcrum, LND and HWI where installed in `.test-env`. HWI runs without a device (it starts, lists devices and is run by Bitcoin Core as its external signer); the signing path uses a stand-in that answers as HWI does. The Electrum wallet is not run by any test |
| Native               | `cargo test`                               | `apps/desktop/src-tauri`                                             | Real Windows DPAPI encryption and tamper detection                                                                                                                                                                                                                                                                                                                               |
| Packaging smoke test | `apps/orchestrator/scripts/smoke-test.mjs` | Runs after every sidecar build                                       | The built single executable: start, RPC, database, shutdown                                                                                                                                                                                                                                                                                                                      |

## Running

```bash
npm test                                        # everything (integration tests skip with a warning without a runtime)
npx vitest run --project node                   # unit
npx vitest run --project desktop                # components
npx vitest run --project integration            # real regtest node
cd apps/desktop/src-tauri && cargo test         # native shell
cd apps/desktop/src-tauri && cargo clippy --all-targets -- -D warnings && cargo fmt --check
```

## Regtest environment

`npx tsx scripts/dev/install-bitcoin-core.ts` installs Bitcoin Core into `.test-env/` with the application's own verified installer (signatures, checksums, Authenticode); `install-bitcoin-knots.ts`, `install-tor.ts`, `install-fulcrum.ts`, `install-hwi.ts` and `install-lnd.ts` do the same for the other programs the integration tests use, and `install-electrum.ts` installs the Electrum wallet for checks made by hand. Integration tests create disposable data directories under the system temporary folder, choose free loopback ports, never touch real networks or funds, and stop every node gracefully afterwards: `shutDownNodeManager` waits until the bitcoind processes of managed nodes have exited (asking again while one is still starting, killing one only as a last resort), and `removeTestRoot` retries while Windows still holds files of a process that has just exited.

The Lightning tests run three LND nodes on one regtest bitcoind (`tests/integration/support/lnd-node.ts`) with `--noseedbackup`, which creates an unencrypted wallet without showing a seed: acceptable for a throwaway test wallet and for nothing else.

## What the tests do not prove yet

- Mainnet and public test networks are not exercised end to end (they would start a multi-hour synchronisation).
- The per-user installer and its uninstaller were tested by hand on Windows 10 (see [`WINDOWS_BUILD.md`](WINDOWS_BUILD.md)); the MSI and upgrades are not tested, and there is no automated installer test.
- Desktop end-to-end tests (WebdriverIO with tauri-driver) are not set up yet.

Mocked results in component tests demonstrate interface behaviour only, never compatibility with a service.
