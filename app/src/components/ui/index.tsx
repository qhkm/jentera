/* ============================================================
   Component kit. Every element resolves through the design tokens
   — no literal colors — so the theme flip stays a single class on
   <html> and the border-strength dial keeps working.

   The classes here (.btn, .card, .tag, .chip …) are defined in
   styles/theme.css, authored dark-first. That is what retires the
   @layer components !important override the static site carries.
   ============================================================ */

import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import type { Tone } from '@/lib/types';
import { DataIcon } from '@/components/Icon';

export type { Tone };

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/* ---- Button ---- */

type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'reco';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  outline: 'btn-outline',
  ghost: 'btn-ghost',
  reco: 'btn-reco',
};

export function Button({ variant = 'primary', className, ...rest }: ButtonProps) {
  return <button className={cx('btn', BUTTON_VARIANT[variant], className)} {...rest} />;
}

/* ---- Surfaces ---- */

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('card', className)} {...rest} />;
}

/* ---- Labels. Mono, uppercase, .12em — the system's signature texture. ---- */

const TAG_TONE: Record<Tone, string> = {
  neutral: '',
  green: 'tag-green',
  red: 'tag-red',
  amber: 'tag-amber',
};

export function Tag({ tone = 'neutral', className, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return <span className={cx('tag', TAG_TONE[tone], className)} {...rest} />;
}

export function Chip({
  active,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return <button type="button" className={cx('chip', active && 'chip-green', className)} {...rest} />;
}

export function Eyebrow({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cx('eyebrow', className)} {...rest} />;
}

/* ---- Identity ---- */

/**
 * Pass `emoji` to render the mapped Phosphor glyph for a playbook value;
 * `children` remains for the rare case a caller needs custom content.
 */
export function Avatar({
  emoji,
  size = 17,
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { emoji?: string; size?: number }) {
  return (
    <span className={cx('avatar', className)} aria-hidden="true" {...rest}>
      {emoji ? <DataIcon emoji={emoji} size={size} /> : children}
    </span>
  );
}

/* ---- Input ---- */

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx('input', className)} {...rest} />;
}

/* ---- Progress ---- */

export function Progress({ value, label }: { value: number; label?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      className="progress"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? 'Progress'}
    >
      <div className="progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

/* ---- Async feedback --------------------------------------------------- */

export function LoadingState({
  title,
  detail,
  compact = false,
  className,
}: {
  title: string;
  detail?: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={cx(
        'flex items-center text-left',
        compact ? 'gap-3 py-1' : 'gap-4 py-2',
        className,
      )}
    >
      <span
        className={cx(
          'loading-ring shrink-0 rounded-full border border-brand-line border-t-brand',
          compact ? 'size-7' : 'size-10',
        )}
        aria-hidden="true"
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm text-text">{title}</span>
        {detail ? <span className="text-[12px] leading-relaxed text-text-secondary">{detail}</span> : null}
      </span>
    </div>
  );
}

/* ---- Section scaffold ---- */

export function Section({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <h2 className="font-pixel text-xl tracking-tight">{title}</h2>
        {description ? (
          <p className="max-w-[66ch] text-sm text-text-secondary">{description}</p>
        ) : null}
      </header>
      {children}
    </section>
  );
}
