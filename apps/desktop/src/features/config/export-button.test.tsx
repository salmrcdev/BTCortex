import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/testing/render';

const callOrchestrator = vi.fn(() => Promise.resolve({ written: true }));
const chooseFileToSave = vi.fn(() => Promise.resolve('D:\\Exports\\Profile-D-test-settings.conf'));

vi.mock('@/lib/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orchestrator')>();
  return { ...actual, callOrchestrator: (...args: unknown[]) => callOrchestrator(...(args as [])) as unknown };
});
vi.mock('@/lib/dialogs', () => ({ chooseFileToSave: (...args: unknown[]) => chooseFileToSave(...(args as [])) }));

const { ExportConfigButton } = await import('./export-button');

describe('Export without secrets', () => {
  it('asks where to save, suggesting a name that is not bitcoin.conf, and lets the orchestrator write it', async () => {
    const user = userEvent.setup();
    await renderPage(<ExportConfigButton nodeId="node-1" nodeName="Profile D test" />);
    await user.click(await screen.findByRole('button', { name: 'Export without secrets…' }));
    expect(chooseFileToSave).toHaveBeenCalledWith('Profile-D-test-settings.conf', [
      { name: 'Configuration file', extensions: ['conf'] },
      { name: 'Text file', extensions: ['txt'] },
    ]);
    await vi.waitFor(() => {
      expect(callOrchestrator).toHaveBeenCalledWith('nodes.config.export', {
        nodeId: 'node-1',
        path: 'D:\\Exports\\Profile-D-test-settings.conf',
      });
    });
  });
});
