// Data contract for the Phase 1 research records in docs/research/.
// Deliberately dependency-free so it runs before the monorepo tooling exists.
// The enumerations mirror the specification: support levels (section 6) and
// implementation states (section 36).

export const CATEGORIES = [
  'full-node',
  'node-platform',
  'electrum-server',
  'indexer',
  'block-explorer',
  'data-service',
  'desktop-wallet',
  'mobile-wallet',
  'multisig-coordinator',
  'hardware-wallet',
  'signing-tool',
  'lightning-implementation',
  'lightning-management',
  'lightning-liquidity',
  'lightning-infrastructure',
  'privacy-network',
  'private-network',
  'remote-access',
  'reverse-proxy',
  'transaction-privacy',
  'payment-processor',
  'payment-tool',
  'ecash',
  'sidechain',
  'nostr',
  'mining',
  'monitoring',
  'developer-tool',
  'test-network',
  'library',
  'backup-tool',
  'security-tool',
  'other',
];

export const MAINTENANCE_STATUSES = ['active', 'maintenance-only', 'stale', 'discontinued', 'superseded', 'unknown'];
export const WINDOWS_NATIVE = ['yes', 'partial', 'no', 'unknown', 'not-applicable'];
export const WSL2_SUPPORT = ['yes', 'likely', 'no', 'unknown', 'not-applicable'];
export const DOCKER_SUPPORT = ['official-image', 'community-image', 'compose-only', 'no', 'unknown', 'not-applicable'];
export const ARCHITECTURES = ['x64', 'arm64', 'x86'];
export const INTERFACE_TYPES = [
  'json-rpc',
  'rest',
  'http',
  'grpc',
  'websocket',
  'zmq',
  'electrum-protocol',
  'p2p',
  'cli',
  'gui',
  'control-protocol',
  'socks',
  'unix-socket',
  'named-pipe',
  'ssh',
  'file',
  'qr',
  'usb',
  'nfc',
  'library-api',
  'other',
];
export const SUPPORT_LEVELS = [
  'fully-managed',
  'managed-wsl2',
  'managed-docker',
  'remote-managed',
  'connected-application',
  'external-launcher',
  'research-only',
  'unsupported',
];
export const FEASIBILITY_RATINGS = ['high', 'medium', 'low', 'none'];
export const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
export const IMPLEMENTATION_STATUSES = [
  'researched',
  'designed',
  'implemented',
  'unit-tested',
  'integration-tested',
  'verified-on-windows',
  'production-ready',
  'experimental',
  'blocked',
  'unsupported',
];
export const DEPENDENCY_RELATIONSHIPS = ['requires', 'optional', 'enhances', 'conflicts'];
export const STANDARD_KINDS = ['BIP', 'BOLT', 'BLIP', 'NIP', 'SLIP', 'LUD', 'BCR', 'specification', 'other'];
export const PACKAGE_ECOSYSTEMS = ['npm', 'crates.io', 'github', 'system', 'nuget', 'other'];
export const PACKAGE_DECISIONS = ['adopt', 'adopt-conditional', 'consider', 'reject'];

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_PATTERN = /^\d{4}-\d{2}(?:-\d{2})?$/;
const URL_PATTERN = /^https?:\/\/\S+$/;

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class Checker {
  constructor(label) {
    this.label = label;
    this.errors = [];
  }

  fail(path, message) {
    this.errors.push(`${this.label}: ${path}: ${message}`);
  }

  string(value, path, { nullable = false, nonEmpty = true } = {}) {
    if (value === null && nullable) return;
    if (typeof value !== 'string') return this.fail(path, `expected string${nullable ? ' or null' : ''}`);
    if (nonEmpty && value.trim() === '') this.fail(path, 'must not be empty');
  }

  url(value, path, { nullable = false } = {}) {
    if (value === null && nullable) return;
    if (typeof value !== 'string' || !URL_PATTERN.test(value))
      this.fail(path, `expected http(s) URL${nullable ? ' or null' : ''}`);
  }

  date(value, path, { nullable = false } = {}) {
    if (value === null && nullable) return;
    if (typeof value !== 'string' || !DATE_PATTERN.test(value))
      this.fail(path, `expected YYYY-MM-DD or YYYY-MM${nullable ? ' or null' : ''}`);
  }

  oneOf(value, allowed, path) {
    if (!allowed.includes(value))
      this.fail(path, `expected one of: ${allowed.join(', ')} (got ${JSON.stringify(value)})`);
  }

  boolean(value, path) {
    if (typeof value !== 'boolean') this.fail(path, 'expected boolean');
  }

  stringArray(value, path, { allowed, nonEmpty = false } = {}) {
    if (!Array.isArray(value)) return this.fail(path, 'expected array of strings');
    if (nonEmpty && value.length === 0) this.fail(path, 'must not be empty');
    value.forEach((item, index) => {
      if (allowed) this.oneOf(item, allowed, `${path}[${index}]`);
      else this.string(item, `${path}[${index}]`);
    });
  }

  sources(value, path) {
    if (!Array.isArray(value) || value.length === 0) return this.fail(path, 'expected a non-empty array of sources');
    value.forEach((source, index) => {
      const p = `${path}[${index}]`;
      if (!isObject(source)) return this.fail(p, 'expected object');
      this.string(source.title, `${p}.title`);
      this.url(source.url, `${p}.url`);
      this.date(source.accessed, `${p}.accessed`);
    });
  }

  knownKeys(value, allowed, path) {
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) this.fail(path, `unknown field "${key}"`);
    }
  }
}

const ENTRY_KEYS = [
  'id',
  'name',
  'category',
  'catalogueEligible',
  'website',
  'repository',
  'purpose',
  'maintenance',
  'latestStableRelease',
  'verifiedOn',
  'platforms',
  'interfaces',
  'cli',
  'remoteManagement',
  'nodeCompatibility',
  'dependencies',
  'networking',
  'storage',
  'resources',
  'security',
  'licence',
  'licenceNotes',
  'integrationMechanisms',
  'supportLevels',
  'recommendedSupportLevel',
  'feasibility',
  'priority',
  'implementationStatus',
  'notes',
  'sources',
  'unverifiedClaims',
];

export function validateEntry(entry, label) {
  const c = new Checker(label);
  if (!isObject(entry)) {
    c.fail('$', 'entry must be an object');
    return c.errors;
  }
  c.knownKeys(entry, ENTRY_KEYS, '$');
  for (const key of ENTRY_KEYS) {
    if (!(key in entry)) c.fail('$', `missing required field "${key}"`);
  }

  if (typeof entry.id !== 'string' || !ID_PATTERN.test(entry.id)) c.fail('id', 'expected kebab-case identifier');
  c.string(entry.name, 'name');
  c.oneOf(entry.category, CATEGORIES, 'category');
  c.boolean(entry.catalogueEligible, 'catalogueEligible');
  c.url(entry.website, 'website', { nullable: true });
  c.url(entry.repository, 'repository', { nullable: true });
  c.string(entry.purpose, 'purpose');

  if (isObject(entry.maintenance)) {
    c.knownKeys(entry.maintenance, ['status', 'evidence', 'supersededBy'], 'maintenance');
    c.oneOf(entry.maintenance.status, MAINTENANCE_STATUSES, 'maintenance.status');
    c.string(entry.maintenance.evidence, 'maintenance.evidence');
    c.string(entry.maintenance.supersededBy, 'maintenance.supersededBy', { nullable: true });
  } else {
    c.fail('maintenance', 'expected object');
  }

  if (entry.latestStableRelease !== null) {
    if (isObject(entry.latestStableRelease)) {
      c.knownKeys(entry.latestStableRelease, ['version', 'date', 'source'], 'latestStableRelease');
      c.string(entry.latestStableRelease.version, 'latestStableRelease.version');
      c.date(entry.latestStableRelease.date, 'latestStableRelease.date', { nullable: true });
      c.url(entry.latestStableRelease.source, 'latestStableRelease.source');
    } else {
      c.fail('latestStableRelease', 'expected object or null');
    }
  }

  c.date(entry.verifiedOn, 'verifiedOn');

  if (isObject(entry.platforms)) {
    const p = entry.platforms;
    c.knownKeys(
      p,
      ['windowsNative', 'windowsVersions', 'windowsArchitectures', 'windowsDistribution', 'wsl2', 'docker', 'other'],
      'platforms',
    );
    c.oneOf(p.windowsNative, WINDOWS_NATIVE, 'platforms.windowsNative');
    c.string(p.windowsVersions, 'platforms.windowsVersions', { nullable: true });
    c.stringArray(p.windowsArchitectures, 'platforms.windowsArchitectures', { allowed: ARCHITECTURES });
    c.string(p.windowsDistribution, 'platforms.windowsDistribution', { nullable: true });
    c.oneOf(p.wsl2, WSL2_SUPPORT, 'platforms.wsl2');
    c.oneOf(p.docker, DOCKER_SUPPORT, 'platforms.docker');
    c.string(p.other, 'platforms.other', { nullable: true });
  } else {
    c.fail('platforms', 'expected object');
  }

  if (Array.isArray(entry.interfaces)) {
    entry.interfaces.forEach((iface, index) => {
      const p = `interfaces[${index}]`;
      if (!isObject(iface)) return c.fail(p, 'expected object');
      c.knownKeys(iface, ['type', 'description', 'authentication', 'documentation'], p);
      c.oneOf(iface.type, INTERFACE_TYPES, `${p}.type`);
      c.string(iface.description, `${p}.description`);
      c.string(iface.authentication, `${p}.authentication`, { nullable: true });
      c.url(iface.documentation, `${p}.documentation`, { nullable: true });
    });
  } else {
    c.fail('interfaces', 'expected array');
  }

  c.string(entry.cli, 'cli', { nullable: true });
  c.string(entry.remoteManagement, 'remoteManagement', { nullable: true });
  c.string(entry.nodeCompatibility, 'nodeCompatibility', { nullable: true });

  if (Array.isArray(entry.dependencies)) {
    entry.dependencies.forEach((dependency, index) => {
      const p = `dependencies[${index}]`;
      if (!isObject(dependency)) return c.fail(p, 'expected object');
      c.knownKeys(dependency, ['ids', 'relationship', 'notes'], p);
      c.stringArray(dependency.ids, `${p}.ids`, { nonEmpty: true });
      if (Array.isArray(dependency.ids)) {
        dependency.ids.forEach((id, i) => {
          if (typeof id !== 'string' || !ID_PATTERN.test(id))
            c.fail(`${p}.ids[${i}]`, 'expected kebab-case identifier');
        });
      }
      c.oneOf(dependency.relationship, DEPENDENCY_RELATIONSHIPS, `${p}.relationship`);
      c.string(dependency.notes, `${p}.notes`, { nullable: true });
    });
  } else {
    c.fail('dependencies', 'expected array');
  }

  c.string(entry.networking, 'networking', { nullable: true });
  c.string(entry.storage, 'storage', { nullable: true });
  c.string(entry.resources, 'resources', { nullable: true });
  c.string(entry.security, 'security');
  c.string(entry.licence, 'licence', { nullable: true });
  c.string(entry.licenceNotes, 'licenceNotes', { nullable: true });
  c.stringArray(entry.integrationMechanisms, 'integrationMechanisms');
  c.stringArray(entry.supportLevels, 'supportLevels', { allowed: SUPPORT_LEVELS, nonEmpty: true });
  c.oneOf(entry.recommendedSupportLevel, SUPPORT_LEVELS, 'recommendedSupportLevel');
  if (Array.isArray(entry.supportLevels) && !entry.supportLevels.includes(entry.recommendedSupportLevel)) {
    c.fail('recommendedSupportLevel', 'must also appear in supportLevels');
  }

  if (isObject(entry.feasibility)) {
    c.knownKeys(entry.feasibility, ['rating', 'notes'], 'feasibility');
    c.oneOf(entry.feasibility.rating, FEASIBILITY_RATINGS, 'feasibility.rating');
    c.string(entry.feasibility.notes, 'feasibility.notes');
  } else {
    c.fail('feasibility', 'expected object');
  }

  c.oneOf(entry.priority, PRIORITIES, 'priority');
  c.oneOf(entry.implementationStatus, IMPLEMENTATION_STATUSES, 'implementationStatus');
  c.string(entry.notes, 'notes', { nullable: true });
  c.sources(entry.sources, 'sources');
  c.stringArray(entry.unverifiedClaims, 'unverifiedClaims');
  return c.errors;
}

const STANDARD_KEYS = ['id', 'kind', 'number', 'title', 'status', 'summary', 'relevance', 'implementedIn', 'sources'];

export function validateStandard(standard, label) {
  const c = new Checker(label);
  if (!isObject(standard)) {
    c.fail('$', 'standard must be an object');
    return c.errors;
  }
  c.knownKeys(standard, STANDARD_KEYS, '$');
  for (const key of STANDARD_KEYS) {
    if (!(key in standard)) c.fail('$', `missing required field "${key}"`);
  }
  if (typeof standard.id !== 'string' || !ID_PATTERN.test(standard.id)) c.fail('id', 'expected kebab-case identifier');
  c.oneOf(standard.kind, STANDARD_KINDS, 'kind');
  c.string(standard.number, 'number', { nullable: true });
  c.string(standard.title, 'title');
  c.string(standard.status, 'status');
  c.string(standard.summary, 'summary');
  c.string(standard.relevance, 'relevance');
  c.stringArray(standard.implementedIn, 'implementedIn');
  c.sources(standard.sources, 'sources');
  return c.errors;
}

const PACKAGE_KEYS = [
  'name',
  'ecosystem',
  'latestVersion',
  'releaseDate',
  'licence',
  'purpose',
  'decision',
  'rationale',
  'windowsNotes',
  'sources',
  'unverifiedClaims',
];

export function validatePackage(pkg, label) {
  const c = new Checker(label);
  if (!isObject(pkg)) {
    c.fail('$', 'package must be an object');
    return c.errors;
  }
  c.knownKeys(pkg, PACKAGE_KEYS, '$');
  for (const key of PACKAGE_KEYS) {
    if (!(key in pkg)) c.fail('$', `missing required field "${key}"`);
  }
  c.string(pkg.name, 'name');
  c.oneOf(pkg.ecosystem, PACKAGE_ECOSYSTEMS, 'ecosystem');
  c.string(pkg.latestVersion, 'latestVersion', { nullable: true });
  c.date(pkg.releaseDate, 'releaseDate', { nullable: true });
  c.string(pkg.licence, 'licence', { nullable: true });
  c.string(pkg.purpose, 'purpose');
  c.oneOf(pkg.decision, PACKAGE_DECISIONS, 'decision');
  c.string(pkg.rationale, 'rationale');
  c.string(pkg.windowsNotes, 'windowsNotes', { nullable: true });
  c.sources(pkg.sources, 'sources');
  c.stringArray(pkg.unverifiedClaims, 'unverifiedClaims');
  return c.errors;
}
