import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import { I18nProvider } from '@/i18n/I18nProvider';
import { FounderGroupInvite } from '@/components/FounderGroupInvite';
import { parseFounderGroup } from '@/lib/founder-group';

const url = `https://chat.whatsapp.com/${'A'.repeat(22)}`;
function tree(repo: LocalRepository, key = 'first') {
  return <RepositoryProvider key={key} repository={repo}><I18nProvider><FounderGroupInvite /></I18nProvider></RepositoryProvider>;
}
beforeEach(() => localStorage.clear());

describe('private founder appreciation invitation', () => {
  it('does not invent payment eligibility for the local demo', async () => {
    const view = render(tree(new LocalRepository()));
    await act(async () => {});
    expect(view.container).toBeEmptyDOMElement();
  });

  it('thanks eligible early supporters and invites feedback without opening or storing the link', async () => {
    const read = vi.fn().mockResolvedValue({ url });
    const open = vi.spyOn(window, 'open');
    const repo = Object.assign(new LocalRepository(), { founderGroup: read });
    render(tree(repo));
    const link = await screen.findByRole('link', { name: /Join the Founder WhatsApp Group/ });
    expect(link).toHaveAttribute('href', url);
    expect(link).toHaveClass('btn-outline');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(screen.getByRole('heading')).toHaveTextContent('Thank you for supporting Jentera early.');
    expect(screen.getByText(/direct access to the founder/)).toHaveTextContent('Joining is optional.');
    expect(screen.getByText(/Other members/)).toHaveTextContent(/passwords/);
    expect(open).not.toHaveBeenCalled();
    expect(Object.values(localStorage).join('')).not.toContain(url);
    open.mockRestore();
  });

  it.each([null, { url: 'javascript:alert(1)' }, { url: url.replace('chat.whatsapp.com', 'attacker.example') }])('fails closed for an ineligible or unsafe response: %j', async value => {
    const read = vi.fn().mockResolvedValue(value);
    const view = render(tree(Object.assign(new LocalRepository(), { founderGroup: read })));
    await waitFor(() => expect(read).toHaveBeenCalledOnce());
    await act(async () => {});
    expect(view.container).toBeEmptyDOMElement();
  });

  it('does not block the platform when the optional support request fails', async () => {
    const read = vi.fn().mockRejectedValue(new Error('offline'));
    const view = render(tree(Object.assign(new LocalRepository(), { founderGroup: read })));
    await waitFor(() => expect(read).toHaveBeenCalledOnce());
    await act(async () => {});
    expect(view.container).toBeEmptyDOMElement();
  });

  it('ignores a previous account response after the repository is remounted', async () => {
    let resolve!: (value: { url: string }) => void;
    const read = vi.fn(() => new Promise<{ url: string }>(done => { resolve = done; }));
    const view = render(tree(Object.assign(new LocalRepository(), { founderGroup: read })));
    await waitFor(() => expect(read).toHaveBeenCalledOnce());
    view.rerender(tree(new LocalRepository(), 'another-account'));
    await act(async () => { resolve({ url }); });
    expect(view.container).toBeEmptyDOMElement();
  });
});

describe('founder link validation', () => {
  it('accepts only the expected HTTPS group invite shape', () => {
    expect(parseFounderGroup({ url })).toEqual({ url });
  });
  it.each([undefined, {}, { url: 1 }, { url: url + '?token=x' }, { url: url + '#x' },
    { url: url.replace('https:', 'http:') }, { url: url.replace('chat.whatsapp.com', 'chat.whatsapp.com.attacker.example') },
    { url: url.replace('chat.whatsapp.com', 'user:password@chat.whatsapp.com') },
    { url: 'https://chat.whatsapp.com/short' }])('rejects malformed or unsafe link %j', value => {
    expect(parseFounderGroup(value)).toBeNull();
  });
});
