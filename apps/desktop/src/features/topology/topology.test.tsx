import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Topology } from '@btcortex/contracts';
import { renderPage } from '@/testing/render';

const callOrchestrator = vi.fn();

vi.mock('@/lib/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orchestrator')>();
  return { ...actual, callOrchestrator: (...args: unknown[]) => callOrchestrator(...args) as unknown };
});

const { TopologyPage } = await import('./topology-page');

const TOPOLOGY: Topology = {
  checkedAt: '2026-10-23T08:00:00.000Z',
  elements: [
    {
      id: 'btcortex',
      kind: 'btcortex',
      label: 'BTCortex',
      detail: 'Version 0.1.0',
      health: 'healthy',
      route: '/',
      layer: 0,
    },
    {
      id: 'node:a',
      kind: 'bitcoin-node',
      label: 'Home node',
      detail: 'Bitcoin Core 31.1 · Signet',
      health: 'healthy',
      route: '/nodes/a',
      layer: 2,
    },
    {
      id: 'tor',
      kind: 'tor',
      label: 'tor',
      detail: 'Tor 0.4.9.14 · connected',
      health: 'healthy',
      route: '/tor',
      layer: 3,
    },
    {
      id: 'tor-network',
      kind: 'tor-network',
      label: 'Tor network',
      detail: 'Relays run by volunteers',
      health: 'healthy',
      route: null,
      layer: 4,
    },
  ],
  links: [
    {
      id: 'btcortex->node:a:RPC',
      from: 'btcortex',
      to: 'node:a',
      protocol: 'RPC',
      port: 38332,
      protection: 'loopback',
      active: true,
      detail: 'Signed in with the cookie file',
    },
    {
      id: 'node:a->tor:SOCKS5',
      from: 'node:a',
      to: 'tor',
      protocol: 'SOCKS5',
      port: 9050,
      protection: 'loopback',
      active: false,
      detail: 'Every connection, to onion peers only',
    },
    {
      id: 'tor->tor-network:Tor',
      from: 'tor',
      to: 'tor-network',
      protocol: 'Tor',
      port: null,
      protection: 'tor',
      active: true,
      detail: 'Circuits built',
    },
  ],
};

beforeEach(() => {
  callOrchestrator.mockReset();
  callOrchestrator.mockResolvedValue(TOPOLOGY);
});

describe('Network topology', () => {
  it('draws every part with its health in words and lists every connection', async () => {
    await renderPage(<TopologyPage />);
    const diagram = await screen.findByRole('img', { name: /Diagram of 4 parts and 3 connections/ });
    expect(
      within(diagram).getByRole('button', { name: 'Home node, Bitcoin Core 31.1 · Signet, Working' }),
    ).toBeDefined();
    expect(within(diagram).getByText('RPC :38332')).toBeDefined();
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      'BTCortexHome nodeRPCSigned in with the cookie file38332This computer onlyLive',
      'Home nodetorSOCKS5Every connection, to onion peers only9050This computer onlyNot live',
      'torTor networkTorCircuits built—Through TorLive',
    ]);
  });

  it('says so when there is nothing to draw yet', async () => {
    callOrchestrator.mockResolvedValue({ ...TOPOLOGY, elements: TOPOLOGY.elements.slice(0, 1), links: [] });
    await renderPage(<TopologyPage />);
    expect(await screen.findByText('Nothing to show yet: set up or connect a node first.')).toBeDefined();
  });
});
