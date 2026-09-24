import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SignedInProvider, useAppsEnabled } from '../gate';

function Probe() {
  return <output>{useAppsEnabled() ? 'on' : 'off'}</output>;
}

describe('apps discovery', () => {
  it.each([
    [true, 1, 'on'],
    [true, 2, 'off'],
    [true, undefined, 'off'],
    [false, 1, 'off'],
  ] as const)('signed in %s with apiVersion %s reads %s', (value, appsVersion, expected) => {
    render(<SignedInProvider value={value} appsVersion={appsVersion}><Probe /></SignedInProvider>);
    expect(screen.getByRole('status')).toHaveTextContent(expected);
  });
});
