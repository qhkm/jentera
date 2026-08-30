import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import SignIn from '@/routes/SignIn';

describe('standalone sign-in layout', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.documentElement.classList.remove('theme-light');
  });

  afterEach(() => {
    document.documentElement.classList.remove('theme-light');
  });

  it('uses minimal auth chrome instead of the landing navigation', () => {
    render(
      <MemoryRouter initialEntries={['/signin']}>
        <SignIn />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Sign in to Jentera' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Jentera home' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByText('Start now')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Light mode' }));
    expect(document.documentElement).toHaveClass('theme-light');
    expect(screen.getByRole('button', { name: 'Dark mode' })).toBeInTheDocument();
  });
});
