import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogueEntryDetail, CatalogueEntrySummary, CatalogueIntegration } from '@btcortex/contracts';
import { renderPage } from '@/testing/render';

const callOrchestrator = vi.fn();
const openExternal = vi.fn();

vi.mock('@/lib/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orchestrator')>();
  return { ...actual, callOrchestrator: (...args: unknown[]) => callOrchestrator(...args) as unknown };
});
vi.mock('@/lib/external', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/external')>()),
  openExternal: (url: string) => Promise.resolve(openExternal(url) as unknown),
}));

const { CataloguePage } = await import('./catalogue-page');
const { CatalogueEntryPage } = await import('./entry-page');

const RESEARCH_ONLY: CatalogueIntegration = {
  status: 'researched',
  level: null,
  capabilities: [],
  route: null,
  state: null,
};

const CORE: CatalogueEntrySummary = {
  id: 'bitcoin-core',
  name: 'Bitcoin Core',
  category: 'full-node',
  purpose: 'Reference implementation of the Bitcoin protocol.',
  targetLevel: 'fully-managed',
  windowsNative: 'yes',
  maintenance: 'active',
  latestVersion: '31.1',
  priority: 'P0',
  integration: {
    status: 'verified-on-windows',
    level: 'fully-managed',
    capabilities: ['detect', 'install', 'start', 'stop'],
    route: '/nodes',
    state: {
      installed: true,
      versions: ['31.1'],
      running: 1,
      health: 'healthy',
      summary: '1 node in BTCortex, 1 running.',
    },
  },
};

const ENTRIES: CatalogueEntrySummary[] = [
  CORE,
  {
    ...CORE,
    id: 'bitcoin-knots',
    name: 'Bitcoin Knots',
    purpose: 'A derivative of Bitcoin Core with different relay policy.',
    integration: { status: 'implemented', level: null, capabilities: ['detect'], route: null, state: null },
  },
  {
    ...CORE,
    id: 'fulcrum',
    name: 'Fulcrum',
    category: 'electrum-server',
    purpose: 'Fast Electrum-protocol server.',
    priority: 'P1',
    integration: RESEARCH_ONLY,
  },
  {
    ...CORE,
    id: 'mempool',
    name: 'The Mempool Open Source Project',
    category: 'block-explorer',
    purpose: 'Explorer and mempool visualiser.',
    targetLevel: 'managed-docker',
    windowsNative: 'no',
    maintenance: 'maintenance-only',
    integration: RESEARCH_ONLY,
  },
];

const FULCRUM: CatalogueEntryDetail = {
  record: {
    id: 'fulcrum',
    name: 'Fulcrum',
    category: 'electrum-server',
    purpose: 'Fast Electrum-protocol server.',
    website: 'https://fulcrumserver.org/',
    repository: 'https://github.com/cculianu/Fulcrum',
    maintenance: { status: 'active', evidence: 'Release 2.1.4 published 2026-10-18.', supersededBy: null },
    latestStableRelease: {
      version: '2.1.4',
      date: '2026-10-18',
      source: 'https://github.com/cculianu/Fulcrum/releases/tag/v2.1.4',
    },
    verifiedOn: '2026-10-21',
    platforms: {
      windowsNative: 'yes',
      windowsVersions: 'Windows 10 or later, 64-bit',
      windowsArchitectures: ['x64'],
      windowsDistribution: 'Portable ZIP',
      wsl2: 'likely',
      docker: 'official-image',
    },
    dependencies: [
      { ids: ['bitcoin-core'], relationship: 'requires', notes: 'Unpruned node with txindex.' },
      { ids: ['tor'], relationship: 'optional', notes: 'Onion service for clients.' },
      { ids: ['electrs', 'electrumx'], relationship: 'conflicts', notes: 'Same default port.' },
    ],
    security: 'Serves wallet history to anyone who can reach its port.',
    licence: 'GPL-3.0-or-later',
    supportLevels: ['fully-managed', 'managed-docker'],
    recommendedSupportLevel: 'fully-managed',
    feasibility: 'high',
    priority: 'P1',
    sources: [
      { title: 'Fulcrum releases', url: 'https://github.com/cculianu/Fulcrum/releases', accessed: '2026-10-21' },
    ],
  },
  integration: RESEARCH_ONLY,
  dependencies: {
    checks: [
      {
        relationship: 'requires',
        ids: ['bitcoin-core'],
        names: ['Bitcoin Core'],
        notes: 'Unpruned node with txindex.',
        present: ['bitcoin-core'],
      },
      { relationship: 'optional', ids: ['tor'], names: ['Tor'], notes: 'Onion service for clients.', present: [] },
      {
        relationship: 'conflicts',
        ids: ['electrs', 'electrumx'],
        names: ['electrs', 'ElectrumX'],
        notes: 'Same default port.',
        present: [],
      },
    ],
    missing: [],
    conflicts: [],
    order: ['bitcoin-core', 'fulcrum'],
    cycle: null,
  },
  names: { 'bitcoin-core': 'Bitcoin Core', tor: 'Tor', electrs: 'electrs', electrumx: 'ElectrumX' },
  catalogueIds: ['bitcoin-core', 'tor', 'electrs', 'electrumx'],
};

beforeEach(() => {
  callOrchestrator.mockReset();
  openExternal.mockReset();
  callOrchestrator.mockImplementation((method: string, params: { id?: string }) => {
    if (method === 'catalogue.list') return Promise.resolve(ENTRIES);
    if (method === 'catalogue.entry' && params.id === 'fulcrum') return Promise.resolve(FULCRUM);
    return Promise.reject(new Error(`unexpected ${method}`));
  });
});

describe('Catalogue', () => {
  it('lists entries by category, telling targets apart from what works today', async () => {
    await renderPage(<CataloguePage />);
    expect(await screen.findByRole('heading', { name: 'Full-node implementations' })).toBeDefined();
    expect(screen.getByRole('status').textContent).toBe('4 entries, 1 available in BTCortex');
    const core = screen.getByRole('link', { name: 'Bitcoin Core' }).closest('li');
    if (!core) throw new Error('row not found');
    expect(within(core).getByText('Available in BTCortex')).toBeDefined();
    expect(within(core).getByText('1 node in BTCortex, 1 running.')).toBeDefined();
    const knots = screen.getByRole('link', { name: 'Bitcoin Knots' }).closest('li');
    if (!knots) throw new Error('row not found');
    expect(within(knots).getByText('Recognised only')).toBeDefined();
    const fulcrum = screen.getByRole('link', { name: 'Fulcrum' }).closest('li');
    if (!fulcrum) throw new Error('row not found');
    // The target level is shown as a target, next to "research only".
    expect(within(fulcrum).getByText('Research only')).toBeDefined();
    expect(within(fulcrum).getByText('Target: Fully managed')).toBeDefined();
    expect(screen.getByText('Maintenance only')).toBeDefined();
  });

  it('filters as you type and from the menus, and offers a way back from no results', async () => {
    const user = userEvent.setup();
    await renderPage(<CataloguePage />);
    await user.type(await screen.findByLabelText('Search'), 'electrum');
    expect(screen.getByRole('status').textContent).toBe('1 entry, 0 available in BTCortex');
    expect(screen.queryByRole('link', { name: 'Bitcoin Core' })).toBeNull();

    await user.clear(screen.getByLabelText('Search'));
    await user.selectOptions(screen.getByLabelText('Show'), 'available');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);

    await user.selectOptions(screen.getByLabelText('Show'), 'native');
    await user.selectOptions(screen.getByLabelText('Target support level'), 'managed-docker');
    expect(screen.getByText('No entry matches these filters.')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Clear the filters' }));
    expect(screen.getByRole('status').textContent).toBe('4 entries, 1 available in BTCortex');
  });
});

describe('Catalogue entry', () => {
  it('shows verified information, checks dependencies and opens websites in the browser', async () => {
    const user = userEvent.setup();
    await renderPage(<CatalogueEntryPage entryId="fulcrum" />);
    expect(await screen.findByRole('heading', { name: 'Fulcrum' })).toBeDefined();
    expect(screen.getByText(/BTCortex does not integrate Fulcrum yet/)).toBeDefined();
    expect(screen.getByText('2.1.4, released 18 Oct 2026')).toBeDefined();
    expect(screen.getByText('Research verified on 21 Oct 2026.')).toBeDefined();
    expect(screen.getByText('Likely (Linux build)')).toBeDefined();

    const requires = screen.getByText('Requires').closest('li');
    if (!requires) throw new Error('dependency not found');
    expect(within(requires).getByText('On this computer')).toBeDefined();
    expect(within(requires).getByRole('link', { name: 'Bitcoin Core' })).toBeDefined();
    const optional = screen.getByText('Works with').closest('li');
    if (!optional) throw new Error('dependency not found');
    expect(within(optional).getByText('Not on this computer')).toBeDefined();
    // Every entry in a conflict group conflicts; "any one of these" would misread it.
    expect(screen.getByText('Conflicts with')).toBeDefined();
    expect(screen.queryByText(/Any one of these/)).toBeNull();
    expect(screen.getByRole('heading', { name: 'Order to set up' })).toBeDefined();
    expect(screen.getByText('(already here)')).toBeDefined();

    await user.click(screen.getByRole('link', { name: /https:\/\/fulcrumserver\.org/ }));
    expect(openExternal).toHaveBeenCalledWith('https://fulcrumserver.org/');
  });

  it('links every integrated entry to the page that manages it', async () => {
    callOrchestrator.mockImplementation((method: string, params: { id?: string }) =>
      method === 'catalogue.entry' && params.id === 'fulcrum'
        ? Promise.resolve({
            ...FULCRUM,
            integration: {
              status: 'implemented',
              level: 'fully-managed',
              capabilities: ['detect', 'start', 'stop'],
              route: '/electrum',
              state: null,
            },
          } satisfies CatalogueEntryDetail)
        : Promise.reject(new Error(`unexpected ${method}`)),
    );
    await renderPage(<CatalogueEntryPage entryId="fulcrum" />);
    const manage = await screen.findByRole('link', { name: 'Manage' });
    expect(manage.getAttribute('href')).toBe('#/electrum');
  });

  it('explains an entry that cannot be found', async () => {
    await renderPage(<CatalogueEntryPage entryId="nothing" />);
    expect(await screen.findByText('This catalogue entry cannot be shown')).toBeDefined();
  });
});
