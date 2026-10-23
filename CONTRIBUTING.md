# Contributing to BTCortex

BTCortex is a Windows desktop application for managing Bitcoin infrastructure. Contributions should preserve the boundaries between the interface, the orchestrator and the native shell, and make behaviour verifiable against real services where appropriate.

## Before starting

- Read the [architecture](docs/ARCHITECTURE.md), [security model](docs/SECURITY_MODEL.md) and [known limitations](docs/KNOWN_LIMITATIONS.md).
- Check existing issues before reporting a bug or proposing a feature.
- Discuss substantial changes in an issue before implementing them.
- Use British English in documentation, comments and interface text.

The repository is currently marked `UNLICENSED`; a public repository does not by itself grant an open-source licence.

## Development environment

Follow [DEVELOPMENT.md](docs/DEVELOPMENT.md) for Windows prerequisites and first-run instructions. Install dependencies from the committed lockfile:

```bash
npm ci --ignore-scripts
```

Keep changes focused. Follow the existing TypeScript, error-handling and runtime-validation conventions. Interface strings belong in `apps/desktop/src/i18n/en-GB.ts`.

## Validation

Run the checks relevant to your change:

```bash
npm run typecheck
npm run lint
npx vitest run --project node --project desktop
npm run research:validate
npm run build:web --workspace @btcortex/desktop
```

Format changed files with Prettier. For service integrations, install the verified runtimes and run the corresponding integration tests. Native changes also require the Rust checks in [TESTING.md](docs/TESTING.md). State which checks ran and which were unavailable.

Never test against a real wallet, production credentials or real funds. Keep fixtures synthetic and use disposable regtest environments.

## Pull requests

Describe the problem, the resulting behaviour and how you verified it. Link the relevant issue and update documentation when behaviour changes. Screenshots help with interface changes; remove personal information before attaching them.

Use descriptive commit messages such as `fix: preserve the selected node after reconnecting` or `docs: clarify Electrum server prerequisites`. Avoid unrelated formatting changes and generated build output.

## Bug reports

Include your Windows version, BTCortex version or commit, the relevant service versions, reproduction steps, expected behaviour and observed behaviour. Attach only sanitised logs. Never include wallet material, RPC passwords, macaroons, private keys or authentication cookies.

Use the private reporting process in [SECURITY.md](SECURITY.md) for vulnerabilities.
