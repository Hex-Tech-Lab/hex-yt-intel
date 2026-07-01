import type { ButtonHTMLAttributes, Ref } from 'react';

/**
 * Canonical button — a thin wrapper over the design system's button classes
 * defined in globals.css (.btn-primary / .btn-secondary / .btn-ghost /
 * .btn-danger + .btn-sm / .btn-icon / .btn-icon-sm). It contributes NO styling
 * of its own — all colors, padding, radius, hover/disabled states live in the
 * one design system. Route every app button through this.
 */
export type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'sm' | 'icon' | 'icon-sm';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  ref?: Ref<HTMLButtonElement>;
}

const variantClass: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  outline: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
};

const sizeClass: Record<ButtonSize, string> = {
  md: '',
  sm: 'btn-sm',
  icon: 'btn-icon',
  'icon-sm': 'btn-icon-sm',
};

const Button = ({ className = '', variant = 'primary', size = 'md', ref, ...props }: ButtonProps) => (
  <button
    ref={ref}
    className={`${variantClass[variant]} ${sizeClass[size]} ${className}`.replace(/\s+/g, ' ').trim()}
    {...props}
  />
);
Button.displayName = 'Button';

export { Button };
