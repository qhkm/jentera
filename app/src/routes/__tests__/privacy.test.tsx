import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import Privacy from '@/routes/Privacy';

function mount() {
  return render(<MemoryRouter><Privacy /></MemoryRouter>);
}

describe('privacy notice', () => {
  it('identifies the controller, data practices and a working privacy contact', () => {
    mount();
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy notice' })).toBeVisible();
    expect(screen.getByText(/Kitakod Ventures \(SSM 202203226187/)).toBeVisible();
    expect(screen.getByText(/People’s Republic of China/)).toBeVisible();
    expect(screen.getByText(/do not sell personal data/)).toBeVisible();
    expect(screen.getAllByRole('link', { name: 'hello@kitakodventures.com' })[0]).toHaveAttribute('href', 'mailto:hello@kitakodventures.com');
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
  });

  it('provides the complete notice in Bahasa Malaysia and marks the language', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Bahasa Malaysia' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Notis privasi' })).toBeVisible();
    expect(screen.getByRole('heading', { name: '11. Hak anda' })).toBeVisible();
    expect(document.querySelector('main')).toHaveAttribute('lang', 'ms');
    expect(document.documentElement).toHaveAttribute('lang', 'ms');
  });

  it('says voice notes are transcribed by Cloudflare Workers AI and the audio is not kept, in both languages', async () => {
    const user = userEvent.setup();
    mount();
    expect(screen.getByText(/Voice notes you send/)).toHaveTextContent(/Cloudflare Workers AI/);
    expect(screen.getByText(/Voice notes you send/)).toHaveTextContent(/audio is not kept/);
    await user.click(screen.getByRole('button', { name: 'Bahasa Malaysia' }));
    expect(screen.getByText(/Nota suara yang anda hantar/)).toHaveTextContent(/Cloudflare Workers AI/);
    expect(screen.getByText(/Nota suara yang anda hantar/)).toHaveTextContent(/Audio tidak disimpan/);
  });

  it('discloses Calendar access, AI processing, retained attachments and revocation without claiming verification', () => {
    mount();
    expect(screen.getByRole('heading', { name: '14. Google sign-in and Google Calendar' })).toBeVisible();
    expect(screen.getByText(/Current Jentera tools read your primary calendar/)).toHaveTextContent(/separate owner approval/);
    expect(screen.getByText(/Relevant event information may be passed/)).toHaveTextContent(/AI and infrastructure providers/);
    expect(screen.getByText(/Calendar refresh tokens are encrypted/)).toHaveTextContent(/not given to the agent/);
    expect(screen.getByText(/Chat attachments are different/)).toHaveTextContent(/private file storage/);
    expect(screen.getByRole('link', { name: 'your Google Account' })).toHaveAttribute('href', 'https://myaccount.google.com/connections');
    expect(screen.getByRole('link', { name: 'Google API Services User Data Policy' })).toHaveAttribute('href', 'https://developers.google.com/terms/api-services-user-data-policy');
    expect(screen.getByText(/Disconnection does not delete Google events/)).toBeVisible();
    expect(screen.getByText('Effective: 17 September 2026')).toBeVisible();
    expect(screen.getByRole('link', { name: 'terms of service' })).toHaveAttribute('href', '/terms');
    expect(screen.queryByText(/Google has verified Jentera/i)).not.toBeInTheDocument();
  });

  it('keeps the Google and attachment disclosures available in Bahasa Malaysia', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Bahasa Malaysia' }));
    expect(screen.getByRole('heading', { name: '14. Log masuk Google dan Google Calendar' })).toBeVisible();
    expect(screen.getByText(/Lampiran chat berbeza/)).toHaveTextContent(/storan fail persendirian/);
    expect(screen.getByText(/Token penyegaran Calendar disulitkan/)).toHaveTextContent(/tidak diberikan kepada ejen/);
    expect(screen.getByRole('link', { name: 'Akaun Google anda' })).toHaveAttribute('href', 'https://myaccount.google.com/connections');
    expect(screen.getByRole('link', { name: 'Dasar Data Pengguna Perkhidmatan API Google' })).toHaveAttribute('href', 'https://developers.google.com/terms/api-services-user-data-policy');
  });

  it('discloses optional public-page analytics and lets people change their preference', async () => {
    const user = userEvent.setup();
    mount();
    expect(screen.getByText(/Our tag does not run in sign-in/)).toBeVisible();
    expect(screen.getByText(/choice is stored in this browser for up to 180 days/)).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Google analytics preferences' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Disable Google analytics' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Bahasa Malaysia' }));
    expect(screen.getByText(/Tag kami tidak berjalan pada halaman log masuk/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Matikan analitik Google' })).toBeEnabled();
  });
});
