# Adding an integration

BTCortex is extensible by design (specification section 29), but it does not load third-party plug-ins at run time: everything it runs is reviewed, built and tested with it, because an integration can hold node credentials, install software and reach wallets. This guide describes how an integration is added to the code base, using the existing ones (Tor, Fulcrum, Sparrow, Electrum, HWI, Trezor Suite, LND) as models.

## 1. Research first

Every integration starts as a research record in `docs/research/data/<scope>.json`, validated by `scripts/research/schema.mjs` (`npm run research:validate`), with a narrative note in `docs/research/notes/<scope>.md`. A record states, from primary sources with dates: what the project is, whether it is maintained, its latest release, Windows support (native, WSL2, Docker), its interfaces and authentication, its dependencies on other entries, security considerations, licence, the integration mechanisms worth using, the support levels possible and recommended, feasibility and priority. Facts that could not be verified go into `unverifiedClaims`. `npm run research:docs` regenerates the research documents and the catalogue data (`packages/catalogue/src/catalogue.generated.json`), so the entry appears in the **Catalogue** as research only.

## 2. An integration package

Code that speaks to the program lives in `packages/integrations/<name>`, independent of the orchestrator so it can be tested on its own:

- **Releases** (`release.ts`): where official releases are, how they are verified, and an `install…` function built on `@btcortex/installation-manager` (`installVerifiedArchive`, `installSignedExecutable` or `installSignedInstaller`). Pinned keys are generated into `signing-key(s).generated.ts` by a script in `scripts/` that checks fingerprints against a known source; never trust a key fetched at run time. The one sanctioned exception is the Tor integration's refresh, because the Tor Project rotates its signing subkeys: before each installation it fetches the Tor Project's key and uses it only when its primary fingerprint is the pinned one, merged into the pinned copy, so only what that primary key certified (new subkeys, expiry dates, revocations) counts and a fetched key can never add a signer.
- **Configuration**: generators and parsers for the program's own files, which never overwrite a user's file without a backup and never change files of an installation BTCortex did not make.
- **Interfaces**: a client for the program's API with explicit timeouts, size limits and errors that say what failed (unreachable, refused, authentication, protocol).
- **Tests** next to the code (`*.test.ts`), against recorded real answers or a local server, never against mocks of `fetch`.

## 3. Contracts

The orchestrator and the interface share Zod schemas in `packages/contracts`:

- data types in a file of their own (for example `lightning.ts`);
- methods in `methods.ts` with `defineMethod({ params, result, access, risk, description })`: `access` names who may call it (`ui`, `shell`), `risk` is `read`, `write` or `dangerous`, and dangerous methods take `confirmed: true`, which the interface sends only from its confirmation dialogue (where what is confirmed depends on the parameters, as for the RPC console, `confirmed` is a boolean and the handler checks it);
- events in `events.ts` for state the interface follows live.

Secrets never appear in a result schema: the interface may send a secret once (a password the user types) but never receives one.

## 4. The orchestrator

In `apps/orchestrator/src/<area>/`:

- a **service** class that owns the integration's state: settings in the settings table (validated when read), secrets in the DPAPI vault (`SecretVault`), background work as jobs (`JobManager`) with progress, regular checks that publish events when something changes, and `AppFailure` errors with a complete explanation (what happened, component, data risk, likely cause, recovery actions);
- **handlers** in `src/handlers/<area>.ts` registering each contract method;
- a **service module** when BTCortex runs instances of the integration: the `ServiceModule` contract in `src/services/service-module.ts` extends the adapter below with dependencies, permissions, documentation, the update centre's product, configuration, installation and removal, and the instances with their health, logs, metrics, what each needs and its lifecycle operations. Register it in the orchestration's module list in `src/main.ts`; its services then appear under **Service orchestration**, started and stopped in dependency order. Declare only the permissions it uses, and give it only the services it needs through its options;
- a **service adapter** in `src/services/adapters.ts` (`ServiceAdapter`: id, implementation status, support level, capabilities, route and a `state()` that reports installed versions, running instances, health and a one-line summary). The adapter turns the catalogue entry from research only into an available integration, and its state feeds the dependency checks of other entries. Its status must equal the feature's state in `docs/implementation/features.json` (a test checks this);
- wiring in `src/main.ts`, including its place in the shutdown order.

## A sample module

`apps/orchestrator/src/services/sample/example-module.ts` fulfils every facet of `ServiceModule` for a stand-in program kept in memory, so the contract can be read in one place and run without installing anything. Its test, in `apps/orchestrator/src/orchestration/orchestration.test.ts`, drives it through the whole lifecycle with the orchestration: detected but not installed; installed as a job; configured; started — its node first, since it needs one; healthy, with its log source and metric series declared; updated when a newer release appears; stopped first when its node stops; and its old version removed. A new module can start as a copy of it, with the stand-in replaced by the integration package's real installer and client.

## Trust and permissions

BTCortex loads no code at run time, so there are no untrusted plug-ins: a module is source code in this repository, reviewed, built, signed and tested with the application. Within it, a module gets only what its options give it — a client of its own program, the job manager, the instance ids it depends on — never the vault, the database or the process table as a whole, and it declares as permissions what it may do on this computer. The declaration is shown to the user next to the module; it describes rather than enforces, since modules run inside the orchestrator, so reviewing a new module includes checking that its code does no more than it declares.

## 5. The interface

A feature folder in `apps/desktop/src/features/<area>/` with TanStack Query hooks (`queries.ts`), pages and components built from `components/ui` and the design system (`design-system/btcortex/MASTER.md`), a route in `app/router.tsx` (with validated search parameters for deep links) and a sidebar entry. Every string goes into `src/i18n/en-GB.ts`, in British English. Consequential actions use `ConfirmButton` and say exactly what will happen; statuses always pair colour with an icon and a label.

## 6. Proving it works

- Component tests with Testing Library (`*.test.tsx`), with the orchestrator mocked at `callOrchestrator`.
- An integration test in `tests/integration/` against the real program, installed into `.test-env` by a script in `scripts/dev/` with the application's own verified installer, on regtest or another test network, cleaning up every process and folder it creates.
- A feature entry in `docs/implementation/features.json` whose state matches the evidence (`npm run status:docs`), and documentation in the relevant guide, including what is not supported.
