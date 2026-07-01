interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  ref?: React.Ref<HTMLInputElement>;
}

/**
 * Canonical input — token-driven, matching the design system. Focus ring comes
 * from the shared .hx-field class in globals.css (box-shadow, on-brand cyan).
 */
const Input = ({ className = '', type = 'text', ref, ...props }: InputProps) => (
  <input
    type={type}
    className={`hx-field flex h-10 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--ink-muted)] outline-none disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    ref={ref}
    {...props}
  />
);
Input.displayName = 'Input';

export { Input };
