import type { TrustedKey } from '@btcortex/installation-manager';
import { BUILDER_KEYS, BUILDER_KEYS_SOURCE } from './builder-keys.generated';

// Trust anchors for Bitcoin Core releases: the builder keys pinned from
// bitcoin-core/guix.sigs (docs/research/notes/full-nodes-core.md §3). Each
// release's SHA256SUMS.asc must carry valid signatures from at least
// DEFAULT_SIGNATURE_THRESHOLD distinct builders.

export const DEFAULT_SIGNATURE_THRESHOLD = 3;

export const BITCOIN_CORE_TRUSTED_KEYS: readonly TrustedKey[] = BUILDER_KEYS.map((key) => ({
  name: key.builder,
  armored: key.armored,
  fingerprints: key.fingerprints,
}));

export const BITCOIN_CORE_TRUST_ANCHORS = `Bitcoin Core builder keys from ${BUILDER_KEYS_SOURCE.repository} at ${BUILDER_KEYS_SOURCE.commit.slice(0, 12)} (retrieved ${BUILDER_KEYS_SOURCE.retrievedOn})`;

/** Expected Authenticode publisher of the Windows executables (defence in depth). */
export const BITCOIN_CORE_CODE_SIGNER = 'Bitcoin Core Code Signing LLC';
