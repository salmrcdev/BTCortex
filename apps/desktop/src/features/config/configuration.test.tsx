import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeConfigDocument, NodeWithStatus } from '@btcortex/contracts';
import { OrchestratorError } from '@/lib/orchestrator';
import { renderPage } from '@/testing/render';
import { runningNode } from '@/testing/fixtures';

const callOrchestrator = vi.fn();

vi.mock('@/lib/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orchestrator')>();
  return { ...actual, callOrchestrator: (...args: unknown[]) => callOrchestrator(...args) as unknown };
});

const { NodeDetailPage } = await import('@/features/nodes/node-detail-page');

const FILE = [
  '# Managed by BTCortex',
  'chain=main',
  'dbcache=450 # tuned for this computer',
  'listen=0',
  'rpcauth=alice:[hidden value 1]',
  '',
].join('\n');

const document: NodeConfigDocument = {
  path: 'C:\\Users\\Dev\\AppData\\Local\\BTCortex\\nodes\\mainnet-1\\bitcoin.conf',
  exists: true,
  editable: true,
  text: FILE,
  revision: 'revision-1',
  modifiedAt: '2026-10-21T09:00:00.000Z',
  restartRequired: false,
  commandLine: [
    { key: 'datadir', value: 'C:\\Users\\Dev\\AppData\\Local\\BTCortex\\nodes\\mainnet-1' },
    { key: 'chain', value: 'main' },
    { key: 'server', value: '1' },
    { key: 'printtoconsole', value: '0' },
  ],
};

/** Answers the orchestrator like a real one: saving replaces the file. */
function orchestrator(node: NodeWithStatus = runningNode, initial: NodeConfigDocument = document) {
  let current = initial;
  return (method: string, params: Record<string, unknown>) => {
    switch (method) {
      case 'nodes.get':
        return Promise.resolve(node);
      case 'nodes.config.get':
        return Promise.resolve(current);
      case 'nodes.config.save':
        current = { ...current, text: String(params['text']), revision: 'revision-2' };
        return Promise.resolve({
          revision: 'revision-2',
          restartRequired: true,
          backup: `${String(current.path)}.btcortex-backup.bak`,
          changedKeys: [],
        });
      case 'nodes.restart':
        return Promise.resolve({ accepted: true });
      default:
        return Promise.reject(new Error(`unexpected ${method}`));
    }
  };
}

beforeEach(() => {
  callOrchestrator.mockReset();
});

async function openConfiguration(node?: NodeWithStatus, initial?: NodeConfigDocument) {
  callOrchestrator.mockImplementation(orchestrator(node, initial));
  await renderPage(<NodeDetailPage nodeId="node-1" section="configuration" />);
  return userEvent.setup();
}

describe('Configuration page', () => {
  it('shows what the file sets, where each value comes from, and locks what BTCortex relies on', async () => {
    await openConfiguration();
    const dbcache = await screen.findByLabelText('dbcache');
    expect(dbcache).toHaveProperty('value', '450');
    expect(screen.getByRole('button', { name: 'Show line 3 in the file' })).toBeDefined();
    const chain = screen.getByLabelText('chain');
    expect(chain).toHaveProperty('disabled', true);
    expect(screen.getAllByText('Managed by BTCortex').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('rpcauth')).toHaveProperty('value', 'alice:[hidden value 1]');
    expect(screen.getByText(/A value is set\. It stays hidden/)).toBeDefined();
  });

  it('saves a change after review, keeping the comment, and restarts the running node', async () => {
    const user = await openConfiguration();
    const dbcache = await screen.findByLabelText('dbcache');
    await user.clear(dbcache);
    await user.type(dbcache, '1024');
    await user.tab();
    expect(screen.getByText('1 setting changed')).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Review and save' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('450')).toBeDefined();
    expect(within(dialog).getByText('1024')).toBeDefined();
    expect(within(dialog).getByRole('checkbox', { name: /Restart the node now/ })).toHaveProperty('checked', true);

    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(callOrchestrator).toHaveBeenCalledWith('nodes.config.save', {
      nodeId: 'node-1',
      text: FILE.replace('dbcache=450', 'dbcache=1024'),
      revision: 'revision-1',
      acceptedRisks: [],
    });
    await vi.waitFor(() => {
      expect(callOrchestrator).toHaveBeenCalledWith('nodes.restart', { nodeId: 'node-1', confirmed: true });
    });
  });

  it('needs explicit confirmation before a setting exposes the node', async () => {
    const user = await openConfiguration();
    await user.selectOptions(await screen.findByLabelText('listen'), '1');
    await user.click(screen.getByRole('button', { name: 'Review and save' }));
    const dialog = await screen.findByRole('alertdialog');
    const save = within(dialog).getByRole('button', { name: 'Save' });
    expect(save).toHaveProperty('disabled', true);

    await user.click(
      within(dialog).getByRole('checkbox', {
        name: 'I understand the risk of listen: It makes the node, its address or its data reachable by more computers or programs.',
      }),
    );
    await user.click(save);
    expect(callOrchestrator).toHaveBeenCalledWith(
      'nodes.config.save',
      expect.objectContaining({ text: FILE.replace('listen=0', 'listen=1'), acceptedRisks: ['listen'] }),
    );
  });

  it('checks the raw file as it is typed and points at the line', async () => {
    const user = await openConfiguration();
    await user.click(await screen.findByRole('tab', { name: 'File' }));
    const editor = screen.getByLabelText('Contents of bitcoin.conf');
    await user.type(editor, 'prune=100');
    const checks = screen.getByRole('region', { name: 'Checks' });
    expect(within(checks).getByText(/A prune target must be at least 550 MiB/)).toBeDefined();
    expect(screen.getByText('1 error to fix')).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Review and save' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true);
  });

  it('shows an existing node’s configuration read only', async () => {
    const external: NodeWithStatus = {
      ...runningNode,
      profile: { ...runningNode.profile, execution: 'external', dataDirectory: null, runtimeVersion: null },
    };
    await openConfiguration(external, {
      ...document,
      editable: false,
      readOnlyReason:
        'BTCortex does not change the configuration of nodes it did not set up. You can still read it here.',
      commandLine: [],
    });
    expect(await screen.findByText(/does not change the configuration of nodes it did not set up/)).toBeDefined();
    expect(screen.getByLabelText('dbcache')).toHaveProperty('disabled', true);
    expect(screen.queryByText('Managed by BTCortex')).toBeNull();
  });
});

describe('Configuration values', () => {
  it('refuses a value containing "#", which Bitcoin Core would cut off', async () => {
    const user = await openConfiguration();
    const rpcauth = await screen.findByLabelText('rpcauth');
    await user.type(rpcauth, '\nbob:salt#hash');
    await user.tab();
    expect(await screen.findByText(/a value cannot contain it/)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Review and save' })).toBeNull();
  });
});

describe('Configuration editor safeguards', () => {
  it('asks before restarting the node to apply a saved change', async () => {
    const user = await openConfiguration(runningNode, { ...document, restartRequired: true });
    await user.click(await screen.findByRole('button', { name: 'Restart now' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(`Restart ${runningNode.profile.name}?`)).toBeDefined();
    expect(callOrchestrator).not.toHaveBeenCalledWith('nodes.restart', expect.anything());
    await user.click(within(dialog).getByRole('button', { name: 'Restart node' }));
    await waitFor(() => {
      expect(callOrchestrator).toHaveBeenCalledWith('nodes.restart', { nodeId: 'node-1', confirmed: true });
    });
  });

  it('offers no restart for a node BTCortex did not set up, and no file creation where nothing can be saved', async () => {
    const external: NodeWithStatus = {
      ...runningNode,
      profile: { ...runningNode.profile, execution: 'external', dataDirectory: null, runtimeVersion: null },
    };
    await openConfiguration(external, {
      ...document,
      exists: false,
      text: '',
      editable: false,
      restartRequired: true,
      readOnlyReason: 'BTCortex does not change the configuration of nodes it did not set up.',
      commandLine: [],
    });
    expect(await screen.findByText(/until the program that runs it restarts it/)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Restart now' })).toBeNull();
    expect(screen.queryByText(/Saving creates the file/)).toBeNull();
  });

  it('keeps a draft on the file it was made from when the file changes on disk', async () => {
    callOrchestrator.mockImplementation(orchestrator());
    const { queryClient } = await renderPage(<NodeDetailPage nodeId="node-1" section="configuration" />);
    const user = userEvent.setup();
    const dbcache = await screen.findByLabelText('dbcache');
    await user.clear(dbcache);
    await user.type(dbcache, '1024');
    await user.tab();

    // Someone edits the file in Notepad, and the page reads it again.
    callOrchestrator.mockImplementation(
      orchestrator(runningNode, { ...document, text: `${FILE}prune=1000\n`, revision: 'revision-9' }),
    );
    await queryClient.invalidateQueries();
    expect(await screen.findByText(/changed on disk after you started editing/)).toBeDefined();
    expect(screen.getByText('1 setting changed')).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Review and save' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Save' }));
    // The revision the draft was made from goes with it, so the orchestrator refuses to overwrite the new file.
    expect(callOrchestrator).toHaveBeenCalledWith(
      'nodes.config.save',
      expect.objectContaining({ revision: 'revision-1', text: FILE.replace('dbcache=450', 'dbcache=1024') }),
    );
  });

  it('never puts a hidden value in a field, so typing replaces it', async () => {
    const user = await openConfiguration(runningNode, {
      ...document,
      text: `${FILE}torpassword=[hidden value 2]\n`,
    });
    const password = await screen.findByLabelText('torpassword');
    expect(password).toHaveProperty('value', '');
    expect(password).toHaveProperty('placeholder', 'Hidden value kept. Type a new one to replace it.');
    // Leaving the empty field keeps the hidden value.
    await user.click(password);
    await user.tab();
    expect(screen.queryByRole('button', { name: 'Review and save' })).toBeNull();

    await user.type(password, 'new-password');
    await user.tab();
    expect(screen.getByText('1 setting changed')).toBeDefined();

    // In a list, a hidden value can only be kept whole.
    const rpcauth = screen.getByLabelText('rpcauth');
    await user.clear(rpcauth);
    // Pasted, because user-event reads '[' as the start of a key name.
    await user.click(rpcauth);
    await user.paste('alice:[hidden value 1]x');
    await user.tab();
    expect(await screen.findByText(/Replace the whole hidden value, or remove the line/)).toBeDefined();
  });

  it('shows the reasons when the orchestrator refuses a save', async () => {
    const user = await openConfiguration();
    const answer = orchestrator();
    callOrchestrator.mockImplementation((method: string, params: Record<string, unknown>) =>
      method === 'nodes.config.save'
        ? Promise.reject(
            new OrchestratorError(-32010, 'refused', {
              code: 'config.invalid',
              message: 'The configuration was not saved because Bitcoin Core would refuse it.',
              component: 'Bitcoin Core (My Bitcoin node)',
              dataRisk: 'none',
              details: { problems: ['Line 7: this hidden value does not belong to the option on that line.'] },
              recoveryActions: [],
            }),
          )
        : answer(method, params),
    );
    const dbcache = await screen.findByLabelText('dbcache');
    await user.clear(dbcache);
    await user.type(dbcache, '1024');
    await user.tab();
    await user.click(screen.getByRole('button', { name: 'Review and save' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(
      await within(dialog).findByText('Line 7: this hidden value does not belong to the option on that line.'),
    ).toBeDefined();
  });

  it('shows a requested line once, not every time the File tab opens again', async () => {
    const user = await openConfiguration();
    await user.click(await screen.findByRole('button', { name: 'Show line 3 in the file' }));
    const editor = screen.getByLabelText('Contents of bitcoin.conf');
    expect(globalThis.document.activeElement).toBe(editor);
    await user.click(screen.getByRole('tab', { name: 'Settings' }));
    await user.click(screen.getByRole('tab', { name: 'File' }));
    expect(globalThis.document.activeElement).not.toBe(screen.getByLabelText('Contents of bitcoin.conf'));
  });

  it('marks only the open section as the current page, and keeps focus when an edit is discarded', async () => {
    const user = await openConfiguration();
    const sections = await screen.findByRole('navigation', { name: 'Node sections' });
    const current = within(sections)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');
    expect(current.map((link) => link.textContent)).toEqual(['Configuration']);

    const dbcache = await screen.findByLabelText('dbcache');
    await user.clear(dbcache);
    await user.type(dbcache, '1024');
    await user.tab();
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    await vi.waitFor(() => {
      expect(globalThis.document.activeElement).toBe(screen.getByRole('tab', { name: 'Settings' }));
    });
  });
});
