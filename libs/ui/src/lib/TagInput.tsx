'use client';

// Holds buffer state, so it only works in a client component. Marked here rather
// than at the barrel so Button and the other ref-only primitives stay usable from
// a server component.
import { KeyboardEvent, useState } from 'react';

export interface TagInputProps {
  id?: string;
  value: string[];
  onChange: (tags: string[]) => void;
  /** Refuses to add beyond this many. Mirrors the schema's cap. */
  maxTags?: number;
  maxTagLength?: number;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * A chip-style editor for a list of short strings.
 *
 * Unlike every other primitive here this holds a `string[]`, which
 * react-hook-form's `register()` cannot drive — consumers wire it with
 * `useController` and pass `value`/`onChange` through.
 *
 * Enter or comma commits the buffer; backspace on an empty buffer removes the
 * last chip, which is the behaviour people expect from this control even though
 * nothing on screen advertises it.
 */
export function TagInput({
  id,
  value,
  onChange,
  maxTags = 20,
  maxTagLength = 30,
  placeholder,
  disabled,
  className,
}: TagInputProps) {
  const [buffer, setBuffer] = useState('');

  const full = value.length >= maxTags;

  function commit() {
    const tag = buffer.trim();
    setBuffer('');
    // Blank, duplicate, or over the cap: all silently ignored rather than
    // raising an error for something the seller can simply see didn't happen.
    if (!tag || full || value.includes(tag)) {
      return;
    }
    onChange([...value, tag.slice(0, maxTagLength)]);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      // Enter would otherwise submit the surrounding form.
      event.preventDefault();
      commit();
      return;
    }
    if (event.key === 'Backspace' && buffer === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div
      className={[
        'flex w-full flex-wrap items-center gap-1.5 rounded-card border border-line',
        'bg-surface px-2.5 py-1.5',
        'focus-within:border-accent focus-within:ring-1 focus-within:ring-accent',
        disabled ? 'opacity-50' : '',
        className ?? '',
      ].join(' ')}
    >
      {value.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-card border border-line bg-line/40 px-1.5 py-0.5 text-xs text-ink"
        >
          {tag}
          <button
            type="button"
            aria-label={`Remove ${tag}`}
            disabled={disabled}
            onClick={() => onChange(value.filter((t) => t !== tag))}
            className="text-ink-muted hover:text-danger"
          >
            ×
          </button>
        </span>
      ))}
      <input
        id={id}
        type="text"
        value={buffer}
        disabled={disabled || full}
        placeholder={full ? `${maxTags} tags maximum` : placeholder}
        maxLength={maxTagLength}
        onChange={(e) => setBuffer(e.target.value)}
        onKeyDown={onKeyDown}
        // Losing focus with text still in the buffer should keep it, not drop it.
        onBlur={commit}
        className="min-w-[8rem] flex-1 bg-transparent text-sm text-ink placeholder:text-ink-muted focus:outline-none disabled:opacity-50"
      />
    </div>
  );
}
