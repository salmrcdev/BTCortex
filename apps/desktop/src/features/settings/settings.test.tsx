import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeWithStatus, SystemInfo } from '@btcortex/contracts';
import type { ShellSettings } from '@/lib/shell';
import { usePreferences } from '@/stores/preferences';
import { runningNode } from '@/testing/fixtures';
import { renderPage } from '@/testing/render';

const callOrchestrator = vi.fn();
const getShellSettings = vi.fn();
const updateShellSettings = vi.fn();

vi.mock('@/lib/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orchestrator')>();
  return {
    ...actual,
    isDesktopRuntime: () => true,
    callOrchestrator: (...args: unknown[]) => callOrchestrator(...args) as unknown,
  };
});

vi.mock('@/lib/shell', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/shell')>();
  return {
    ...actual,
    getShellSettings: () => getShellSettings() as unknown,
    updateShellSettings: (...args: unknown[]) => updateShellSettings(...args) as unknown,
  };
});

const { SettingsPage } = await import('./settings-page');

const SHELL: ShellSettings = {
  closeToTray: false,
  startMinimised: true,
  startWithWindows: false,
  disabledByWindows: false,
  autostartSupported: true,
};

const external: NodeWithStatus = {
  ...runningNode,
  profile: {
    ...runningNode.profile,
    id: 'node-2',
    name: 'Laptop node',
    execution: 'external',
    runtimeVersion: null,
    dataDirectory: null,
    keepRunningOnExit: true,
  },
};

const INFO: SystemInfo = {
  product: { name: 'BTCortex', version: '0.1.0' },
  orchestrator: {
    version: '0.1.0',
    runtime: 'Node.js 26.1.0',
    processId: 42,
    startedAt: '2026-10-23T08:00:00.000Z',
    dataDirectory: 'C:\\Users\\Dev\\AppData\\Local\\BTCortex',
    developmentMode: false,
  },
  platform: {
    os: 'windows',
    release: '10.0.19045',
    architecture: 'x64',
    cpuModel: 'Test CPU',
    logicalProcessors: 6,
    totalMemoryBytes: 8_000_000_000,
    freeMemoryBytes: 4_000_000_000,
  },
};

beforeEach(() => {
  usePreferences.setState({ theme: 'system' });
  getShellSettings.mockReset();
  getShellSettings.mockResolvedValue(SHELL);
  updateShellSettings.mockReset();
  updateShellSettings.mockImplementation((update: Partial<ShellSettings>) => Promise.resolve({ ...SHELL, ...update }));
  callOrchestrator.mockReset();
  callOrchestrator.mockImplementation((method: string, params: Record<string, unknown>) => {
    switch (method) {
      case 'nodes.list':
        return Promise.resolve([runningNode, external]);
      case 'nodes.lifecycle.configure':
        return Promise.resolve({ ...runningNode.profile, ...params });
      case 'system.getInfo':
        return Promise.resolve(INFO);
      default:
        return Promise.reject(new Error(`unexpected ${method}`));
    }
  });
});

async function card(name: string) {
  const section = (await screen.findByRole('heading', { name })).closest('section');
  if (!section) throw new Error(`The ${name} card is missing.`);
  return section;
}

describe('Settings', () => {
  it('chooses the theme, following Windows by default', async () => {
    const user = userEvent.setup();
    await renderPage(<SettingsPage />);
    const appearance = await card('Appearance');
    expect(
      within(appearance)
        .getByRole('radio', { name: /Follow Windows/ })
        .getAttribute('aria-checked'),
    ).toBe('true');
    await user.click(within(appearance).getByRole('radio', { name: /^Light/ }));
    expect(usePreferences.getState().theme).toBe('light');
  });

  it('starts with Windows and keeps running in the notification area when asked', async () => {
    const user = userEvent.setup();
    await renderPage(<SettingsPage />);
    const startup = await card('Starting and closing');
    const minimised = await within(startup).findByRole('checkbox', { name: 'Open in the notification area' });
    // Opening in the notification area only applies to a start with Windows.
    expect(minimised).toHaveProperty('disabled', true);
    await user.click(within(startup).getByRole('checkbox', { name: 'Start BTCortex when I sign in to Windows' }));
    expect(updateShellSettings).toHaveBeenCalledWith({ startWithWindows: true });
    expect(await within(startup).findByRole('checkbox', { name: 'Open in the notification area' })).toHaveProperty(
      'disabled',
      false,
    );
    await user.click(
      within(startup).getByRole('checkbox', {
        name: 'Keep running in the notification area when the window is closed',
      }),
    );
    expect(updateShellSettings).toHaveBeenCalledWith({ closeToTray: true });
  });

  it('says when Windows’ own start-up settings have turned BTCortex off', async () => {
    getShellSettings.mockResolvedValue({ ...SHELL, startWithWindows: true, disabledByWindows: true });
    await renderPage(<SettingsPage />);
    expect(await screen.findByText(/Windows’ start-up settings have turned BTCortex off/)).toBeDefined();
  });

  it('chooses which nodes start with BTCortex and keep running after it quits', async () => {
    const user = userEvent.setup();
    await renderPage(<SettingsPage />);
    const lifecycle = await card('Nodes when BTCortex starts and quits');
    const start = await within(lifecycle).findByRole('checkbox', { name: 'Start My Bitcoin node with BTCortex' });
    expect(start).toHaveProperty('checked', false);
    await user.click(start);
    expect(callOrchestrator).toHaveBeenCalledWith('nodes.lifecycle.configure', {
      nodeId: 'node-1',
      startWithBtcortex: true,
    });
    await user.click(
      within(lifecycle).getByRole('checkbox', { name: 'Keep My Bitcoin node running after BTCortex quits' }),
    );
    expect(callOrchestrator).toHaveBeenCalledWith('nodes.lifecycle.configure', {
      nodeId: 'node-1',
      keepRunningOnExit: true,
    });
    // Nodes BTCortex only connects to have no such choice.
    expect(within(lifecycle).queryByRole('checkbox', { name: /Laptop node/ })).toBeNull();
    expect(within(lifecycle).getByText(/left as they are: Laptop node/)).toBeDefined();
  });

  it('shows where the data lives, what is sent, and the versions', async () => {
    await renderPage(<SettingsPage />);
    const data = await card('Data and privacy');
    expect(await within(data).findByText('C:\\Users\\Dev\\AppData\\Local\\BTCortex')).toBeDefined();
    expect(within(data).getByText(/no telemetry, analytics or crash reporting/)).toBeDefined();
    const about = await card('About BTCortex');
    expect(await within(about).findByText('0.1.0 · Node.js 26.1.0')).toBeDefined();
    expect(within(about).getByText('10.0.19045 · x64')).toBeDefined();
  });
});
