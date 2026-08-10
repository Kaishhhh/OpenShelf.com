import { InputHTMLAttributes, forwardRef } from 'react';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={[
        'w-full rounded-card border border-line bg-surface px-2.5 py-1.5',
        'text-sm text-ink placeholder:text-ink-muted',
        'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent',
        'disabled:opacity-50',
        className ?? '',
      ].join(' ')}
      {...props}
    />
  )
);

Input.displayName = 'Input';
