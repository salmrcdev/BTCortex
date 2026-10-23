# Security policy

BTCortex is under development and has no stable release or supported release line yet. Reports should identify the affected commit and the versions of any connected services.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/salmrcdev/BTCortex/security/advisories/new). Do not disclose an exploitable vulnerability in a public issue or pull request.

Include:

- The affected component and commit.
- Reproduction steps using a disposable environment.
- The security impact and any prerequisites.
- A minimal proof of concept, if available.

Use synthetic data and regtest. Never include real seed phrases, wallet files, private keys, RPC credentials, macaroons, authentication cookies or unredacted diagnostic bundles.

Reports are reviewed by the repository maintainer. There is no guaranteed response time or bug bounty programme.

## Security boundaries

The [security model](docs/SECURITY_MODEL.md) documents trust boundaries and controls. [Known limitations](docs/KNOWN_LIMITATIONS.md) records incomplete protections and operational constraints. Third-party services and their security policies remain independent of BTCortex.
