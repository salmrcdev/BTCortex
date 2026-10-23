import { dirname } from 'node:path';
import { NETWORK_PARAMETERS } from '@btcortex/bitcoin-config';
import type { NodeProfile } from '@btcortex/contracts';

/**
 * The root data directory of a node whose files are on this computer: the
 * profile's own for nodes BTCortex manages, or derived from the cookie for an
 * existing local node (the cookie lives in the network folder).
 */
export function localDataDirectory(profile: NodeProfile): string | undefined {
  if (profile.dataDirectory) return profile.dataDirectory;
  if (profile.authentication.kind !== 'cookie') return undefined;
  const networkFolder = dirname(profile.authentication.cookieFile);
  return NETWORK_PARAMETERS[profile.network].subdirectory === '' ? networkFolder : dirname(networkFolder);
}
