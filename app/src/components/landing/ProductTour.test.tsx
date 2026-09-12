import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ProductTour } from './ProductTour';

describe('product screenshots', () => {
  it('labels demo content, switches screenshots by keyboard, and ships both sizes', async () => {
    const user = userEvent.setup();
    render(<ProductTour />);
    const tour = screen.getByRole('region', { name: 'From a job to a result.' });
    expect(within(tour).getByText(/not customer results/)).toBeVisible();
    const buttons = within(tour).getAllByRole('button');
    expect(buttons).toHaveLength(4);
    for (const button of buttons) {
      button.focus();
      await user.keyboard('{Enter}');
      expect(button).toHaveAttribute('aria-pressed', 'true');
      expect(buttons.filter(b => b.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
      const img = within(tour).getByRole('img');
      expect(img).toHaveAttribute('loading', 'lazy');
      expect(img.getAttribute('alt')!.length).toBeGreaterThan(30);
      for (const asset of [img.getAttribute('src'), tour.querySelector('source')?.getAttribute('srcset')]) {
        expect(asset).toBeTruthy();
        expect(existsSync(resolve('public', asset!.slice(1)))).toBe(true);
      }
      expect(within(tour).getByRole('link', { name: /full-size screenshot/ })).toHaveAttribute('href', img.getAttribute('src'));
    }
  });
});
