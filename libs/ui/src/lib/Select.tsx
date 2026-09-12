import { forwardRef, SelectHTMLAttributes } from 'react';

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

/**
 * Styled to match Input so the two line up when they sit in the same form.
 * forwardRef is required for react-hook-form's {...register()} to reach the
 * underlying element.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={[
        'w-full rounded-card border border-line bg-surface px-2.5 py-1.5',
        'text-sm text-ink',
        'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent',
        'disabled:opacity-50',
        className ?? '',
      ].join(' ')}
      {...props}
    >
      {children}
    </select>
  )
);
Select.displayName = 'Select';
