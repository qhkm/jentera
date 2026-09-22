import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import LaunchPost from '@/routes/LaunchPost';
import LandingV3 from '@/routes/LandingV3';
import { INDEXABLE_PATHS, metaEntries, pageSeo } from '@/lib/seo';

describe('Jentera launch post', () => {
  it('links the V3 hero announcement to the complete post', () => {
    render(<MemoryRouter><LandingV3 /></MemoryRouter>);
    expect(screen.getByRole('link', { name: /Jentera is here.*Read the launch post/i }))
      .toHaveAttribute('href', '/blog/meet-jentera');
  });

  it('uses working section navigation and presents the launch price on the page', () => {
    render(<MemoryRouter><LandingV3 /></MemoryRouter>);
    const navigation = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(within(navigation).queryByRole('link', { name: 'Connections' })).toBeNull();
    expect(within(navigation).getByRole('link', { name: 'Product' })).toHaveAttribute('href', '#lv3-product');
    expect(within(navigation).getByRole('link', { name: 'Use cases' })).toHaveAttribute('href', '#lv3-team');
    expect(within(navigation).getByRole('link', { name: 'How it works' })).toHaveAttribute('href', '#lv3-how');
    expect(within(navigation).getByRole('link', { name: 'Pricing' })).toHaveAttribute('href', '#lv3-pricing');
    const pricing = screen.getByRole('region', { name: 'Start with one clear plan.' });
    expect(within(pricing).getByText('RM99')).toBeVisible();
    expect(within(pricing).getByText(/Then RM199\/month from month 4/)).toBeVisible();
    expect(screen.getByText('Built in 🇲🇾.')).toBeVisible();
  });

  it('explains the product without promising universal website automation', () => {
    render(<MemoryRouter><LaunchPost /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/AI staff for the work your business still does by hand/i);
    expect(screen.getByRole('heading', { name: /computer for the business/i })).toBeVisible();
    expect(screen.getByRole('heading', { name: /see the work/i })).toBeVisible();
    expect(screen.getByText(/some services may restrict automated access/i)).toBeVisible();
    expect(screen.getByText(/Start with 10 free chats/i)).toBeVisible();
    expect(screen.getByRole('contentinfo')).toHaveTextContent('Built in 🇲🇾.');
    expect(screen.getByRole('link', { name: /Back to Jentera/i })).toHaveAttribute('href', '/');
  });

  it('is an indexable first-party page with canonical metadata', () => {
    expect(INDEXABLE_PATHS as readonly string[]).toContain('/blog/meet-jentera');
    expect(pageSeo('/blog/meet-jentera')).toMatchObject({
      indexable: true,
      canonical: 'https://jentera.ai/blog/meet-jentera',
      title: 'Meet Jentera — AI staff for real business work',
    });
    expect(metaEntries('/blog/meet-jentera')).toContainEqual({ attribute: 'name', key: 'robots', content: 'index, follow, max-image-preview:large' });
  });
});
