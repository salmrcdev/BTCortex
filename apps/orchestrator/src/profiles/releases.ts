import { fetchLatestReleaseVersion, releaseFiles } from '@btcortex/integration-bitcoin-core';
import { fetchLatestFulcrumVersion, fulcrumReleaseFiles } from '@btcortex/integration-fulcrum';
import { fetchLatestTrezorSuiteVersion, trezorSuiteReleaseFiles } from '@btcortex/integration-hardware-wallets';
import { fetchLatestHwiVersion, hwiReleaseFiles } from '@btcortex/integration-hwi';
import { fetchLatestSparrowVersion, sparrowReleaseFiles } from '@btcortex/integration-sparrow';
import { fetchLatestTorVersion, torReleaseFiles } from '@btcortex/integration-tor';

// What a deployment would download: the release each program would be
// installed from and the size of its archive as the publisher's server
// reports it (a HEAD request, nothing downloaded). Answers are kept for an
// hour, so that reviewing a profile several times does not use up GitHub's
// allowance of anonymous requests; a failed look-up is asked again next time.

export type InstallableComponent = 'bitcoin-core' | 'tor' | 'electrum-server' | 'sparrow' | 'hwi' | 'trezor-suite';

export interface ReleaseSize {
  version: string | null;
  bytes: number | null;
}

const SOURCES: Record<
  InstallableComponent,
  { latest: (fetchImplementation: typeof fetch) => Promise<string>; archive: (version: string) => string }
> = {
  'bitcoin-core': { latest: fetchLatestReleaseVersion, archive: (version) => releaseFiles(version).windowsArchive },
  tor: { latest: fetchLatestTorVersion, archive: (version) => torReleaseFiles(version).archive },
  'electrum-server': { latest: fetchLatestFulcrumVersion, archive: (version) => fulcrumReleaseFiles(version).archive },
  sparrow: { latest: fetchLatestSparrowVersion, archive: (version) => sparrowReleaseFiles(version).archive },
  hwi: { latest: fetchLatestHwiVersion, archive: (version) => hwiReleaseFiles(version).archive },
  'trezor-suite': {
    latest: fetchLatestTrezorSuiteVersion,
    archive: (version) => trezorSuiteReleaseFiles(version).installer,
  },
};

const KEEP_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 10_000;

export class ReleaseSizes {
  private readonly cache = new Map<InstallableComponent, { at: number; value: Promise<ReleaseSize> }>();

  constructor(
    private readonly fetchImplementation: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  lookup(component: InstallableComponent): Promise<ReleaseSize> {
    const cached = this.cache.get(component);
    if (cached && this.now() - cached.at < KEEP_MS) return cached.value;
    const value = this.ask(component);
    this.cache.set(component, { at: this.now(), value });
    void value.then((size) => {
      if (size.version === null || size.bytes === null) this.cache.delete(component);
    });
    return value;
  }

  private async ask(component: InstallableComponent): Promise<ReleaseSize> {
    const source = SOURCES[component];
    const limited: typeof fetch = (input, init) =>
      this.fetchImplementation(input, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    let version: string;
    try {
      version = await source.latest(limited);
    } catch {
      return { version: null, bytes: null };
    }
    try {
      const response = await limited(source.archive(version), { method: 'HEAD', redirect: 'follow' });
      const length = Number(response.headers.get('content-length'));
      return { version, bytes: response.ok && Number.isFinite(length) && length > 0 ? length : null };
    } catch {
      return { version, bytes: null };
    }
  }
}
