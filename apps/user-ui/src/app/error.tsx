'use client';

/**
 * Catches a failed server render — most plausibly product-service being
 * unreachable, which server-api deliberately throws on rather than rendering as
 * "no results". An error boundary must be a client component.
 */
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-card border border-line bg-surface p-6">
      <h1 className="text-base font-semibold text-ink">Something went wrong</h1>
      <p className="text-sm text-ink-muted">
        The catalogue could not be loaded. This is usually temporary.
      </p>
      <button
        type="button"
        onClick={reset}
        className="self-start rounded-card border border-line px-2 py-1 text-sm text-ink hover:border-accent"
      >
        Try again
      </button>
    </div>
  );
}
