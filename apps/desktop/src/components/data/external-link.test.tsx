import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/testing/render';

const openUrl = vi.fn();

vi.mock('@/lib/external', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/external')>()),
  openExternal: (url: string) => Promise.resolve(openUrl(url) as unknown),
}));

const { ExternalLink } = await import('./external-link');

beforeEach(() => {
  openUrl.mockReset();
});

describe('ExternalLink', () => {
  it('opens an https address in the browser', async () => {
    const user = userEvent.setup();
    await renderPage(<ExternalLink href="https://example.org/">Example</ExternalLink>);
    await user.click(await screen.findByRole('link', { name: /^Example\s*\(opens in your browser\)$/ }));
    expect(openUrl).toHaveBeenCalledWith('https://example.org/');
  });

  it.each([
    ['an onion service', `http://${'a'.repeat(56)}.onion/`],
    ['an onion service over https', `https://${'a'.repeat(56)}.onion./`],
    ['a device on the local network', 'http://192.168.1.20:23000/api-keys/authorize'],
  ])('copies the address of %s instead of opening the browser', async (_kind, href) => {
    const user = userEvent.setup();
    await renderPage(<ExternalLink href={href}>Server</ExternalLink>);
    await user.click(await screen.findByRole('link', { name: /^Server\s*\(copies the address\)$/ }));
    await waitFor(async () => {
      expect(await navigator.clipboard.readText()).toBe(href);
    });
    expect(openUrl).not.toHaveBeenCalled();
  });
});
