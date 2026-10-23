import { z } from 'zod';
import { InstalledProductSchema, SoftwareUpdateSchema } from '@btcortex/contracts';
import type {
  BackupSettings,
  ComponentUpdate,
  InstalledProduct,
  InstalledSoftware,
  NodeProfile,
  NodeStatus,
  NodeVersion,
  NodeWithStatus,
  SoftwareUpdate,
  TorStatus,
  UpdateSecurity,
  UpdatesOverview,
} from '@btcortex/contracts';
import { compareKnotsVersions, parseKnotsVersion } from '@btcortex/integration-bitcoin-knots';
import type { Logger } from '../logging/logger';
import type { SettingsStore } from '../persistence/settings';
import {
  coreVersionFromNumber,
  coreVersionRisk,
  formatCoreVersion,
  majorUpgradeNotes,
  parseCoreVersion,
} from '../nodes/version-risk';

// The update centre (specification section 23): releases are looked up at
// most once a day in the background (and whenever the user asks), compared
// with what BTCortex installed and what each node runs, and described with
// their release notes, what an update touches and, for Bitcoin Core, what a
// move to a new major version changes for good. Nothing is updated without
// the user: the page starts the same verified installation and node moves the
// Installed software page uses. Deferring hides an update until a date or for
// that version; security-relevant updates keep their mark.

const SETTINGS_KEY = 'updates';
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
const LOOK_EVERY_MS = 6 * 60 * 60 * 1000;
const FIRST_LOOK_MS = 60_000;
/** How long the last overview stands for the monitoring's alerts. */
const PENDING_REUSE_MS = 10 * 60 * 1000;
const RECOMMENDED_TOR = new Set(['recommended', 'new', 'new in series', 'up to date']);

const NAMES: Record<InstalledProduct, string> = {
  'bitcoin-core': 'Bitcoin Core',
  'bitcoin-knots': 'Bitcoin Knots',
  sparrow: 'Sparrow',
  tor: 'Tor',
  hwi: 'HWI',
  fulcrum: 'Fulcrum',
  electrum: 'Electrum',
};

const IMPACT: Record<InstalledProduct, string[]> = {
  'bitcoin-core': [
    'The new version is installed beside the current one; each node keeps its version until you move it, which restarts it.',
  ],
  'bitcoin-knots': [
    'The new version is installed beside the current one; each Knots node keeps its version until you move it, which restarts it.',
    'A Bitcoin Knots release can change the consensus rules its nodes follow: read its release notes before moving a node.',
  ],
  sparrow: ['Close Sparrow first; its wallets and settings are kept.'],
  tor: ['tor restarts with the new version; nodes that use Tor reconnect within a minute or so.'],
  hwi: ['Used from then on whenever BTCortex talks to a hardware wallet.'],
  fulcrum: ['Electrum servers restart with the new version; wallets reconnect by themselves.'],
  electrum: ['Used the next time Electrum is opened from BTCortex.'],
};

function releaseNotes(product: InstalledProduct, version: string): string {
  switch (product) {
    case 'bitcoin-core':
      return `https://bitcoincore.org/en/releases/${version}/`;
    case 'bitcoin-knots':
      return `https://github.com/bitcoinknots/bitcoin/releases/tag/v${version}`;
    case 'sparrow':
      return `https://github.com/sparrowwallet/sparrow/releases/tag/${version}`;
    case 'hwi':
      return `https://github.com/bitcoin-core/HWI/releases/tag/${version}`;
    case 'fulcrum':
      return `https://github.com/cculianu/Fulcrum/releases/tag/v${version}`;
    case 'electrum':
      return `https://github.com/spesmilo/electrum/blob/${version}/RELEASE-NOTES`;
    case 'tor':
      return 'https://www.torproject.org/download/tor/';
  }
}

const StoredSchema = z.object({
  lastCheck: z.object({ at: z.string(), results: z.array(SoftwareUpdateSchema) }).nullable(),
  deferred: z.record(z.string(), z.object({ version: z.string(), until: z.string().nullable() })),
});
type Stored = z.infer<typeof StoredSchema>;

export interface UpdateServiceOptions {
  settings: SettingsStore;
  installations: { list(): Promise<InstalledSoftware[]>; checkUpdates(): Promise<SoftwareUpdate[]> };
  nodes: () => NodeWithStatus[];
  tor: () => Promise<TorStatus>;
  backups: () => BackupSettings;
  version: string;
  logger: Logger;
  now?: () => Date;
}

/** Updates the monitoring raises alerts for. */
export interface PendingUpdate {
  product: InstalledProduct;
  name: string;
  latest: string;
  security: UpdateSecurity | null;
}

/**
 * A Bitcoin Knots node: only a newer Knots release BTCortex installed is
 * offered, never Bitcoin Core, and Bitcoin Core's security notes do not apply.
 */
function knotsNodeVersion(profile: NodeProfile, status: NodeStatus, newestInstalled: string | undefined): NodeVersion {
  const managed = profile.execution === 'managed';
  const reported = /Satoshi:([\d.]+)\/Knots:(\d{8})/.exec(status.snapshot?.network.subversion ?? '');
  const version = managed ? profile.runtimeVersion : reported ? `${reported[1] ?? ''}.knots${reported[2] ?? ''}` : null;
  const current = version === null ? undefined : parseKnotsVersion(version);
  const newest = newestInstalled === undefined ? undefined : parseKnotsVersion(newestInstalled);
  const newer = managed && current && newest && compareKnotsVersions(newest, current) > 0 ? newest.text : null;
  return {
    nodeId: profile.id,
    name: profile.name,
    network: profile.network,
    implementation: 'bitcoin-knots',
    managed,
    version,
    newer,
    security: null,
    notes:
      newer === null
        ? []
        : ['A Bitcoin Knots release can change the consensus rules the node follows: read its release notes first.'],
  };
}

/**
 * Orders two versions of one product. Bitcoin Knots versions are compared by
 * their numbers first (29.4.knots… is older than 29.4.2.knots…), which a plain
 * string comparison gets wrong; other products' versions compare numerically.
 */
export function compareVersions(product: InstalledProduct, a: string, b: string): number {
  if (product === 'bitcoin-knots') {
    const [first, second] = [parseKnotsVersion(a), parseKnotsVersion(b)];
    if (first && second) return compareKnotsVersions(first, second);
  }
  return a.localeCompare(b, 'en', { numeric: true });
}

export class UpdateService {
  private timers: NodeJS.Timeout[] = [];
  private checking: Promise<void> | undefined;
  private lastComponents: { at: number; components: ComponentUpdate[] } | undefined;

  constructor(private readonly options: UpdateServiceOptions) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private load(): Stored {
    return this.options.settings.get(SETTINGS_KEY, StoredSchema) ?? { lastCheck: null, deferred: {} };
  }

  private save(stored: Stored): void {
    this.options.settings.set(SETTINGS_KEY, stored);
  }

  initialise(): void {
    const look = () => {
      const last = this.load().lastCheck;
      if (!last || this.now().getTime() - Date.parse(last.at) >= CHECK_EVERY_MS) {
        void this.check().catch((error: unknown) => {
          this.options.logger.warn('The daily update check failed', { error });
        });
      }
    };
    const first = setTimeout(look, FIRST_LOOK_MS);
    first.unref();
    const later = setInterval(look, LOOK_EVERY_MS);
    later.unref();
    this.timers.push(first, later);
  }

  shutdown(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  /** Asks the publishers for their newest releases and keeps the answer. */
  check(): Promise<void> {
    this.checking ??= (async () => {
      const results = await this.options.installations.checkUpdates();
      this.save({ ...this.load(), lastCheck: { at: this.now().toISOString(), results } });
      this.lastComponents = undefined;
      this.options.logger.info('Checked for updates', {
        available: results.filter((result) => result.updateAvailable).map((result) => result.product),
      });
    })().finally(() => {
      this.checking = undefined;
    });
    return this.checking;
  }

  defer(product: InstalledProduct, version: string, days: number | null): void {
    this.lastComponents = undefined;
    const stored = this.load();
    const until = days === null ? null : new Date(this.now().getTime() + days * 24 * 60 * 60 * 1000).toISOString();
    this.save({ ...stored, deferred: { ...stored.deferred, [product]: { version, until } } });
  }

  resume(product: InstalledProduct): void {
    this.lastComponents = undefined;
    const stored = this.load();
    const deferred = Object.fromEntries(Object.entries(stored.deferred).filter(([name]) => name !== product));
    this.save({ ...stored, deferred });
  }

  private activeDeferral(product: InstalledProduct, latest: string | null, stored: Stored) {
    const deferral = stored.deferred[product];
    if (!deferral || latest === null || deferral.version !== latest) return null;
    if (deferral.until !== null && Date.parse(deferral.until) <= this.now().getTime()) return null;
    return deferral;
  }

  async overview(refresh: boolean): Promise<UpdatesOverview> {
    if (refresh) await this.check();
    const stored = this.load();
    const software = await this.options.installations.list().catch(() => []);
    const tor = await this.options.tor().catch(() => undefined);
    const nodes = this.options.nodes();

    const installedOf = (product: InstalledProduct) =>
      software
        .filter((entry) => entry.product === product)
        .map((entry) => entry.version)
        .sort((a, b) => compareVersions(product, b, a));

    // Bitcoin Core's security follows the versions the nodes run.
    const nodeVersions: NodeVersion[] = nodes.map(({ profile, status }) => {
      const managed = profile.execution === 'managed';
      const running = status.snapshot?.network.version;
      if (profile.implementation === 'bitcoin-knots') {
        return knotsNodeVersion(profile, status, installedOf('bitcoin-knots')[0]);
      }
      const current = managed
        ? parseCoreVersion(profile.runtimeVersion)
        : running === undefined
          ? undefined
          : coreVersionFromNumber(running);
      const newestInstalled = installedOf('bitcoin-core')[0];
      const newest = parseCoreVersion(newestInstalled);
      const newer =
        managed &&
        current &&
        newest &&
        (newest.major > current.major || (newest.major === current.major && newest.minor > current.minor))
          ? (newestInstalled ?? null)
          : null;
      const risk = current ? coreVersionRisk(current) : undefined;
      return {
        nodeId: profile.id,
        name: profile.name,
        network: profile.network,
        implementation: 'bitcoin-core',
        managed,
        version: current ? formatCoreVersion(current) : null,
        newer,
        security: risk ? { severity: risk.severity, reason: risk.reason } : null,
        notes: newer && current && newest ? majorUpgradeNotes(current, newest) : [],
      };
    });

    const components = InstalledProductSchema.options.map((product): ComponentUpdate => {
      const installed = installedOf(product);
      const result = stored.lastCheck?.results.find((entry) => entry.product === product);
      const latest = result?.latest ?? null;
      const newestInstalled = installed[0] ?? null;
      const held = result?.held ?? null;
      const state: ComponentUpdate['state'] =
        newestInstalled === null
          ? 'not-installed'
          : latest === null
            ? 'unknown'
            : held === null && compareVersions(product, latest, newestInstalled) > 0
              ? 'available'
              : 'current';
      let security: UpdateSecurity | null = null;
      if (product === 'bitcoin-core') {
        const worst = nodeVersions
          .filter((node) => node.managed && node.security)
          .sort((a, b) => (a.security?.severity === 'critical' ? -1 : b.security?.severity === 'critical' ? 1 : 0))[0];
        security = worst?.security ?? null;
      } else if (product === 'tor' && tor?.versionStatus && !RECOMMENDED_TOR.has(tor.versionStatus)) {
        security = {
          severity: 'warning',
          reason: `The Tor network rates the tor that runs as "${tor.versionStatus}".`,
        };
      }
      return {
        product,
        name: NAMES[product],
        installed,
        latest,
        state,
        security,
        releaseNotes: latest === null ? null : releaseNotes(product, latest),
        impact: IMPACT[product],
        deferred: this.activeDeferral(product, latest, stored),
        error: result?.error ?? null,
        held,
      };
    });
    this.lastComponents = { at: this.now().getTime(), components };

    const backups = (() => {
      try {
        return this.options.backups();
      } catch {
        return undefined;
      }
    })();
    return {
      checkedAt: stored.lastCheck?.at ?? null,
      btcortex: {
        version: this.options.version,
        detail:
          'BTCortex does not update itself yet: its releases are not published with signatures that it could verify. Install a newer BTCortex by hand when one is released.',
      },
      components,
      nodes: nodeVersions,
      lastBackupAt: backups?.lastRun?.outcome === 'succeeded' ? backups.lastRun.at : null,
    };
  }

  /** Available updates that are not deferred, or are but matter for security; from the last overview. */
  async pending(): Promise<PendingUpdate[]> {
    const cached = this.lastComponents;
    const components =
      cached && this.now().getTime() - cached.at < PENDING_REUSE_MS
        ? cached.components
        : (await this.overview(false)).components;
    return components.flatMap((component) =>
      component.state === 'available' &&
      component.latest !== null &&
      (component.deferred === null || component.security !== null)
        ? [{ product: component.product, name: component.name, latest: component.latest, security: component.security }]
        : [],
    );
  }
}
