// The documentation shipped inside BTCortex (specification sections 24.1 and
// 33): the files in docs/, each loaded only when it is opened or searched.
// The ecosystem research is left out; it is far larger than everything else
// together and is summarised by the catalogue.

const SOURCES = import.meta.glob<string>(['../../../../../docs/*.md', '!../../../../../docs/ECOSYSTEM_RESEARCH.md'], {
  query: '?raw',
  import: 'default',
});

export type DocumentGroup = 'using' | 'trust' | 'reference' | 'developers';

export const DOCUMENT_GROUPS: readonly DocumentGroup[] = ['using', 'trust', 'reference', 'developers'];

export const DOCUMENTS = [
  { id: 'USER_GUIDE', group: 'using' },
  { id: 'INSTALLATION', group: 'using' },
  { id: 'TROUBLESHOOTING', group: 'using' },
  { id: 'NODE_MANAGEMENT', group: 'using' },
  { id: 'WALLET_INTEGRATIONS', group: 'using' },
  { id: 'LIGHTNING_INTEGRATIONS', group: 'using' },
  { id: 'PRIVACY_AND_TOR', group: 'using' },
  { id: 'BACKUP_AND_RECOVERY', group: 'using' },
  { id: 'REMOTE_MANAGEMENT', group: 'using' },
  { id: 'SECURITY_MODEL', group: 'trust' },
  { id: 'KNOWN_LIMITATIONS', group: 'trust' },
  { id: 'IMPLEMENTATION_STATUS', group: 'trust' },
  { id: 'INTEGRATION_MATRIX', group: 'reference' },
  { id: 'DEPENDENCY_MATRIX', group: 'reference' },
  { id: 'ARCHITECTURE', group: 'developers' },
  { id: 'DEVELOPMENT', group: 'developers' },
  { id: 'TESTING', group: 'developers' },
  { id: 'WINDOWS_BUILD', group: 'developers' },
  { id: 'RELEASE_PROCESS', group: 'developers' },
  { id: 'PLUGIN_DEVELOPMENT', group: 'developers' },
] as const satisfies readonly { id: string; group: DocumentGroup }[];

export type DocumentId = (typeof DOCUMENTS)[number]['id'];

export function isDocumentId(value: unknown): value is DocumentId {
  return DOCUMENTS.some((document) => document.id === value);
}

export async function loadDocument(id: DocumentId): Promise<string> {
  const load = Object.entries(SOURCES).find(([path]) => path.endsWith(`/${id}.md`))?.[1];
  if (!load) throw new Error(`The document ${id} is not part of this build.`);
  return load();
}

/** Where each area of the window is explained, for F1 and the help links. */
const CONTEXT: Record<string, { document: DocumentId; section: string }> = {
  '': { document: 'USER_GUIDE', section: 'overview' },
  catalogue: { document: 'USER_GUIDE', section: 'catalogue' },
  services: { document: 'USER_GUIDE', section: 'service-orchestration' },
  profiles: { document: 'USER_GUIDE', section: 'deployment-profiles' },
  nodes: { document: 'USER_GUIDE', section: 'bitcoin-nodes' },
  explorer: { document: 'USER_GUIDE', section: 'explorer' },
  electrum: { document: 'USER_GUIDE', section: 'electrum-servers' },
  lightning: { document: 'USER_GUIDE', section: 'lightning' },
  payments: { document: 'USER_GUIDE', section: 'payments--merchants' },
  wallets: { document: 'WALLET_INTEGRATIONS', section: '' },
  remote: { document: 'REMOTE_MANAGEMENT', section: '' },
  hardware: { document: 'USER_GUIDE', section: 'hardware-wallets' },
  tor: { document: 'PRIVACY_AND_TOR', section: '' },
  topology: { document: 'USER_GUIDE', section: 'network-topology' },
  developer: { document: 'USER_GUIDE', section: 'developer-tools' },
  software: { document: 'USER_GUIDE', section: 'installed-software' },
  updates: { document: 'USER_GUIDE', section: 'updates' },
  monitoring: { document: 'USER_GUIDE', section: 'monitoring' },
  storage: { document: 'USER_GUIDE', section: 'storage' },
  logs: { document: 'USER_GUIDE', section: 'logs--diagnostics' },
  backups: { document: 'BACKUP_AND_RECOVERY', section: '' },
  security: { document: 'SECURITY_MODEL', section: '' },
  settings: { document: 'USER_GUIDE', section: 'settings' },
  welcome: { document: 'USER_GUIDE', section: 'the-first-start' },
};

/** The help for the area a path belongs to; the user guide when there is none. */
export function helpFor(pathname: string): { document: DocumentId; section: string } {
  const area = pathname.split('/')[1] ?? '';
  return CONTEXT[area] ?? { document: 'USER_GUIDE', section: '' };
}
