import type { ButtonHTMLAttributes, Ref } from 'react';

/**
 * Canonical button — the single source of truth for button styling.
 * Everything derives from the design tokens in globals.css (@theme):
 * radius (rounded-lg → var(--radius-control)), colors, focus ring.
 * Route ALL app buttons through this instead of hand-rolling <button>.
 */
export type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'icon' | 'icon-sm';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  ref?: Ref<HTMLButtonElement>;
}

const base =
  'inline-flex items-center justify-center gap-2 rounded-lg font-sans font-medium cursor-pointer ' +
  'transition-all duration-[var(--dur-fast)] focus:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--void)] ' +
  'disabled:opacity-40 disabled:cursor-not-allowed';

const sizes: Record<ButtonSize, string> = {
  sm: 'min-h-[36px] px-3 text-xs',
  md: 'min-h-[44px] px-5 text-sm',
  icon: 'h-11 w-11 p-0',
  'icon-sm': 'h-9 w-9 p-0',
};

const variants: Record<ButtonVariant, string> = {
  primary:
    'border-none bg-[var(--accent-strong)] text-[var(--void)] font-bold shadow-[0_4px_14px_var(--accent-glow)] hover:bg-[var(--accent)]',
  outline:
    'border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-secondary)] hover:border-[var(--line-strong)] hover:text-[var(--ink)]',
  ghost:
    'border-none bg-transparent text-[var(--ink-secondary)] hover:text-[var(--ink)] hover:bg-[var(--line-faint)]',
  danger:
    'border border-[var(--err)] bg-[rgb(239_68_68_/_0.15)] text-[var(--err)] font-semibold hover:bg-[rgb(239_68_68_/_0.25)]',
};

const Button = ({ className = '', variant = 'primary', size = 'md', ref, ...props }: ButtonProps) => (
  <button ref={ref} className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...props} />
);
Button.displayName = 'Button';

export { Button };
