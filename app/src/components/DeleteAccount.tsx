import { useState } from 'react';

/* This screen is the whole point of the plan: make the consequences
   concrete before the confirm, not after. Confirmation is retyping the
   account's own email address, because two of the three sign-in doors
   (magic link, Google) have no password to re-enter — a password prompt
   would be a dead end for them.

   Plain English, not run through t(): the rest of the dashboard is
   bilingual, but the wording here is safety-critical and is exercised by
   a test that renders this component with no I18nProvider — matching the
   account-deletion email copy, which is also English-only. */
const GRACE_DAYS = 7;

interface Props {
  /** The signed-in account's own address. Compared against what is typed,
      case- and whitespace-insensitively. */
  email: string;
  /** Scheduled jobs that will stop. Zero hides the line rather than
      stating a false consequence. */
  routines: number;
  onDelete: (email: string) => Promise<unknown>;
  /** Render the confirmation card straight away, skipping the toggle
      button — for a caller (the account menu) that already has its own
      "Delete my account" trigger. Omit for the standalone toggle button
      below. */
  startOpen?: boolean;
  /** Called when the owner backs out, in addition to collapsing this
      component's own state — lets a controlling menu return to its
      normal view. */
  onCancel?: () => void;
}

/* No `text-*` or `py-*` utility on .btn or .input: they own their type and
   padding through --control-h, and overriding it has broken the shared
   control height three times. */
export default function DeleteAccount({ email, routines, onDelete, startOpen = false, onCancel }: Props) {
  const [open, setOpen] = useState(startOpen);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cancel() {
    setOpen(false);
    setTyped('');
    setError(null);
    onCancel?.();
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-outline" onClick={() => setOpen(true)}>
        Delete my account
      </button>
    );
  }

  const matches = typed.trim().toLowerCase() === email.toLowerCase();

  return (
    <section className="card mt-4 px-4 py-3" aria-label="Delete my account">
      <strong className="block">This cannot be undone after {GRACE_DAYS} days.</strong>
      <ul className="mt-2 list-disc pl-5 text-text-secondary">
        <li>You are signed out on every device now.</li>
        <li>Your chats, files and business data are erased in {GRACE_DAYS} days.</li>
        {routines > 0 && (
          <li>
            {routines} scheduled {routines === 1 ? 'job' : 'jobs'} you set up will stop.
          </li>
        )}
      </ul>
      <label className="mt-3 block" htmlFor="confirm-email">
        Type your email address to confirm
      </label>
      <input
        id="confirm-email"
        className="input mt-1"
        value={typed}
        autoComplete="off"
        spellCheck={false}
        disabled={busy}
        onChange={(event) => setTyped(event.target.value)}
      />
      {error && (
        <p role="alert" className="mt-2 text-sm text-text-secondary">
          {error}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="btn btn-outline account-menu-delete-confirm"
          disabled={busy || !matches}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onDelete(typed.trim());
            } catch (reason) {
              /* The route writes these for a person to read — a team that is
                 not empty, an address that does not match. Render verbatim. */
              setError(reason instanceof Error ? reason.message : 'Could not delete your account.');
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Deleting…' : 'Delete permanently'}
        </button>
        <button type="button" className="btn btn-outline" disabled={busy} onClick={cancel}>
          Keep my account
        </button>
      </div>
    </section>
  );
}
