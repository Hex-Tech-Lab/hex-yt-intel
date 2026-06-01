interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  ref?: React.Ref<HTMLDivElement>;
}

const Card = ({ className = '', ref, ...props }: CardProps) => (
  <div
    ref={ref}
    className={`rounded-lg border border-slate-700 bg-slate-900/40 text-slate-200 shadow-lg backdrop-blur-sm ${className}`}
    {...props}
  />
);
Card.displayName = 'Card';

export { Card };
