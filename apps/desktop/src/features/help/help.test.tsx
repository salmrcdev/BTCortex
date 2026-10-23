import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderPage } from '@/testing/render';
import { helpFor } from './documents';
import { HelpPage } from './help-page';

describe('Help & documentation', () => {
  it('shows the user guide with its sections and the list of documents', async () => {
    await renderPage(<HelpPage search={{}} />, '/help');
    expect(await screen.findByRole('heading', { level: 1, name: 'BTCortex user guide' })).toBeDefined();
    const outline = screen.getByRole('navigation', { name: 'On this page' });
    expect(within(outline).getByRole('link', { name: 'When something goes wrong' })).toBeDefined();
    const documents = screen.getByRole('navigation', { name: 'Documents' });
    expect(within(documents).getByRole('link', { name: 'User guide' }).getAttribute('aria-current')).toBe('page');
    expect(within(documents).getByRole('link', { name: 'Security model' })).toBeDefined();
  });

  it('opens another document', async () => {
    await renderPage(<HelpPage search={{ doc: 'TROUBLESHOOTING' }} />, '/help');
    expect(await screen.findByRole('heading', { level: 1, name: 'Troubleshooting' })).toBeDefined();
  });

  it('searches every document', async () => {
    const user = userEvent.setup();
    await renderPage(<HelpPage search={{}} />, '/help');
    await user.type(await screen.findByRole('searchbox', { name: 'Search the documentation' }), 'pruned node');
    const results = await screen.findByRole('region', { name: 'Search results' });
    expect(within(results).getAllByRole('link').length).toBeGreaterThan(0);
    await user.clear(screen.getByRole('searchbox', { name: 'Search the documentation' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search the documentation' }), 'zzqqxx');
    expect(await screen.findByText('Nothing in the documentation mentions “zzqqxx”.')).toBeDefined();
  });

  it('knows which part of the documentation explains each page', () => {
    expect(helpFor('/monitoring')).toEqual({ document: 'USER_GUIDE', section: 'monitoring' });
    expect(helpFor('/nodes/abc/peers')).toEqual({ document: 'USER_GUIDE', section: 'bitcoin-nodes' });
    expect(helpFor('/backups')).toEqual({ document: 'BACKUP_AND_RECOVERY', section: '' });
    expect(helpFor('/nowhere')).toEqual({ document: 'USER_GUIDE', section: '' });
  });
});
