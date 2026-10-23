import type { TrustedKey } from '@btcortex/installation-manager';
import { BUILDER_KEYS, BUILDER_KEYS_SOURCE } from './builder-keys.generated';

// Trust anchors for Bitcoin Knots releases: the builder keys pinned from
// bitcoinknots/guix.sigs. Each release's SHA256SUMS.asc must carry valid
// signatures from at least DEFAULT_SIGNATURE_THRESHOLD distinct builders, one
// of them the maintainer's, who signs every release.

export const DEFAULT_SIGNATURE_THRESHOLD = 3;

/** Luke Dashjr, primary key 1A3E 761F 19D2 CC77 85C5 502E A291 A2C4 5D0C 504A. */
export const RELEASE_MAINTAINER = 'luke-jr';

export const BITCOIN_KNOTS_TRUSTED_KEYS: readonly TrustedKey[] = BUILDER_KEYS.map((key) => ({
  name: key.builder,
  armored: key.armored,
  fingerprints: key.fingerprints,
}));

export const BITCOIN_KNOTS_TRUST_ANCHORS = `Bitcoin Knots builder keys from ${BUILDER_KEYS_SOURCE.repository} at ${BUILDER_KEYS_SOURCE.commit.slice(0, 12)} (retrieved ${BUILDER_KEYS_SOURCE.retrievedOn}), with the maintainer's signature required`;
