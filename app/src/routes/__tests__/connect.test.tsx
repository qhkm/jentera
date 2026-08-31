import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import Connect from '@/routes/Connect';

describe('Jentera Connect product page', () => {
  it('explains the product direction without claiming target connectors are live', () => {
    render(
      <MemoryRouter>
        <Connect />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('heading', { name: /connect any ai agent to southeast asia/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/these are target areas/i)).toBeInTheDocument();
    expect(screen.getAllByText('target').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /request early access/i })).toHaveAttribute(
      'href',
      expect.stringMatching(/^mailto:/),
    );
  });
});
