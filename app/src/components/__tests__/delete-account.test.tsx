import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import DeleteAccount from '@/components/DeleteAccount';

describe('DeleteAccount', () => {
  it('will not delete until the address is typed exactly', async () => {
    const request = vi.fn();
    render(<DeleteAccount email="owner@example.com" onDelete={request} routines={3} />);

    await userEvent.click(screen.getByRole('button', { name: /delete my account/i }));
    expect(screen.getByText(/3 scheduled jobs you set up will stop/i)).toBeInTheDocument();

    const confirm = screen.getByRole('button', { name: /delete permanently/i });
    expect(confirm).toBeDisabled();

    /* The gate is the whole confirmation, and jumping from empty straight
       to exact never checked it: a prefix, a near-miss and a different
       address must all leave the button disabled. */
    const field = screen.getByLabelText(/type your email/i);
    await userEvent.type(field, 'owner@exam');
    expect(confirm).toBeDisabled();
    await userEvent.clear(field);
    await userEvent.type(field, 'owner@example.co');
    expect(confirm).toBeDisabled();
    await userEvent.clear(field);
    await userEvent.type(field, 'someone.else@example.com');
    expect(confirm).toBeDisabled();
    await userEvent.clear(field);

    await userEvent.type(field, 'owner@example.com');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(request).toHaveBeenCalledWith('owner@example.com');
  });

  it('says what an owner must do first when the team is not empty', async () => {
    const request = vi.fn().mockRejectedValue(
      new Error('Remove the other people from your team first, then delete your account.'),
    );
    render(<DeleteAccount email="owner@example.com" onDelete={request} routines={0} />);
    await userEvent.click(screen.getByRole('button', { name: /delete my account/i }));
    await userEvent.type(screen.getByLabelText(/type your email/i), 'owner@example.com');
    await userEvent.click(screen.getByRole('button', { name: /delete permanently/i }));
    expect(await screen.findByText(/remove the other people/i)).toBeInTheDocument();
  });

  it('says so when the scheduled jobs could not be counted', async () => {
    /* Silently omitting the line reads as "you have none", which is a
       different statement from "we could not check". */
    render(<DeleteAccount email="owner@example.com" onDelete={vi.fn()} routines={null} />);
    await userEvent.click(screen.getByRole('button', { name: /delete my account/i }));
    expect(screen.getByText(/could not check/i)).toBeInTheDocument();
  });

  it('does not show the routines line when nothing is scheduled', async () => {
    render(<DeleteAccount email="owner@example.com" onDelete={vi.fn()} routines={0} />);
    await userEvent.click(screen.getByRole('button', { name: /delete my account/i }));
    expect(screen.queryByText(/scheduled job/i)).not.toBeInTheDocument();
  });

  it('is case- and whitespace-insensitive about the typed address', async () => {
    const request = vi.fn();
    render(<DeleteAccount email="Owner@Example.com" onDelete={request} routines={0} />);
    await userEvent.click(screen.getByRole('button', { name: /delete my account/i }));
    const confirm = screen.getByRole('button', { name: /delete permanently/i });
    await userEvent.type(screen.getByLabelText(/type your email/i), '  owner@example.com  ');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(request).toHaveBeenCalledWith('owner@example.com');
  });

  it('can be dismissed without deleting anything', async () => {
    const request = vi.fn();
    render(<DeleteAccount email="owner@example.com" onDelete={request} routines={0} />);
    await userEvent.click(screen.getByRole('button', { name: /delete my account/i }));
    await userEvent.click(screen.getByRole('button', { name: /keep my account/i }));
    expect(screen.getByRole('button', { name: /delete my account/i })).toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });
});
