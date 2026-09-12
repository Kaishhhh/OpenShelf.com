import { forwardRef, TextareaHTMLAttributes } from 'react';

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

/**
 * Styled to match Input so the two line up in the same form. forwardRef is
 * required for react-hook-form's {...register()} to reach the element.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, rows = 3, ...props }, ref) => (
    <textarea
      ref={ref}
      rows={rows}
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
Textarea.displayName = 'Textarea';
