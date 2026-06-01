interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline';
  ref?: React.Ref<HTMLButtonElement>;
}

const Button = ({ className = '', variant = 'default', ref, ...props }: ButtonProps) => {
  const baseStyles =
    'inline-flex items-center justify-center rounded-lg font-medium text-sm h-10 px-4 py-2 transition-all focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-offset-2 focus:ring-offset-[#0A0E17] disabled:opacity-50 disabled:cursor-not-allowed';
  const variantStyles =
    variant === 'outline'
      ? 'border border-slate-700 bg-slate-900/50 text-slate-200 hover:bg-slate-800 hover:border-slate-600'
      : 'bg-cyan-600 text-black hover:bg-cyan-500 hover:shadow-[0_0_20px_rgba(34,211,238,0.3)]';

  return (
    <button
      ref={ref}
      className={`${baseStyles} ${variantStyles} ${className}`}
      {...props}
    />
  );
};
Button.displayName = 'Button';

export { Button };
