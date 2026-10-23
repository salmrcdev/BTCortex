# LND transport fixtures

The certificates and private keys in this directory are disposable fixtures for local HTTPS transport tests in `lnd.test.ts`. They do not protect any service or wallet and must never be used outside tests.

`server-cert.pem` and `server-key.pem` identify the local test server. The other pair exercises certificate mismatch handling. `lnd-0.21.4-regtest.json` records responses from a disposable regtest environment.
