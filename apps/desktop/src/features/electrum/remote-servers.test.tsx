import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RemoteElectrumTest, RemoteElectrumWithStatus } from '@btcortex/contracts';
import { runningNode } from '@/testing/fixtures';
import { renderPage } from '@/testing/render';

const callOrchestrator = vi.fn();

vi.mock('@/lib/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orchestrator')>();
  return { ...actual, callOrchestrator: (...args: unknown[]) => callOrchestrator(...args) as unknown };
});

const { RemoteServers } = await import('./remote-servers');

const FINGERPRINT = Array.from({ length: 32 }, () => 'AB').join(':');
const TESTED: RemoteElectrumTest = {
  reachable: true,
  serverVersion: 'electrs/0.10.9',
  protocolVersion: '1.4',
  genesisHash: '00'.repeat(32),
  network: 'mainnet',
  height: 968_000,
  certificate: {
    fingerprint: FINGERPRINT,
    subject: 'umbrel.local',
    issuer: 'umbrel.local',
    validFrom: 'Jan 1 00:00:00 2026 GMT',
    validTo: 'Jan 1 00:00:00 2036 GMT',
    publiclyTrusted: false,
  },
  error: null,
};
const LISTED: RemoteElectrumWithStatus = {
  server: {
    id: 'e1',
    name: 'Umbrel',
    host: 'umbrel.local',
    port: 50002,
    tls: true,
    via: 'direct',
    certificateFingerprint: FINGERPRINT,
    nodeId: 'node-1',
    addedAt: '2026-10-23T12:00:00.000Z',
  },
  status: {
    state: 'certificate-changed',
    serverVersion: 'electrs/0.10.9',
    network: 'mainnet',
    height: 968_000,
    checkedAt: '2026-10-23T12:01:00.000Z',
    error: 'The server presented a different certificate from the one you accepted.',
    unreachableSince: null,
  },
};

let listed: RemoteElectrumWithStatus[] = [];

beforeEach(() => {
  listed = [];
  callOrchestrator.mockReset();
  callOrchestrator.mockImplementation((method: string) => {
    switch (method) {
      case 'electrum.remote.list':
        return Promise.resolve(listed);
      case 'electrum.remote.test':
        return Promise.resolve(TESTED);
      case 'electrum.remote.add':
        return Promise.resolve([LISTED]);
      case 'nodes.list':
        return Promise.resolve([runningNode]);
      default:
        return Promise.reject(new Error(`unexpected ${method}`));
    }
  });
});

describe('Electrum servers on other computers', () => {
  it('tests a server, shows its certificate and adds it only once the certificate is accepted', async () => {
    const user = userEvent.setup();
    await renderPage(<RemoteServers />);
    await user.type(await screen.findByLabelText('Address'), 'umbrel.local');
    await user.selectOptions(screen.getByLabelText('Use for address lookups of'), 'node-1');
    await user.click(screen.getByRole('button', { name: 'Test the server' }));
    expect(callOrchestrator).toHaveBeenCalledWith(
      'electrum.remote.test',
      { host: 'umbrel.local', port: 50002, tls: true, via: 'direct' },
      { timeoutMs: 90_000 },
    );
    expect(await screen.findByText('electrs/0.10.9 answered, on Mainnet at block 968,000.')).toBeDefined();
    expect(screen.getByText(/No authority Windows trusts vouches for its certificate/)).toBeDefined();
    expect(screen.getByText(FINGERPRINT)).toBeDefined();
    const add = screen.getByRole('button', { name: 'Add the server' });
    expect(add.hasAttribute('disabled')).toBe(true);
    await user.click(screen.getByLabelText(/This is my server’s certificate/));
    await user.click(add);
    expect(callOrchestrator).toHaveBeenCalledWith(
      'electrum.remote.add',
      {
        host: 'umbrel.local',
        port: 50002,
        tls: true,
        via: 'direct',
        name: 'umbrel.local',
        certificateFingerprint: FINGERPRINT,
        nodeId: 'node-1',
      },
      { timeoutMs: 90_000 },
    );
    expect(await screen.findByText('Its certificate changed')).toBeDefined();
  });

  it('says a server served a node and why it is not answering now', async () => {
    listed = [LISTED];
    await renderPage(<RemoteServers />);
    expect(await screen.findByText('Umbrel')).toBeDefined();
    expect(screen.getByText(/presented a different certificate/)).toBeDefined();
    expect(await screen.findByText(/Answers the address lookups of My Bitcoin node/)).toBeDefined();
  });
});
