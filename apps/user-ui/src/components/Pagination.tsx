'use client';

import { useRouter, useSearchParams } from 'next/navigation';

/**
 * Page controls that own their own URL writes.
 *
 * It cannot take an `onPage` callback any more: a server component cannot pass a
 * function across the boundary. Taking only serializable props and doing the navigation
 * itself is what lets a server-rendered page use it at all.
 */
export function Pagination({
  page,
  totalPages,
  total,
}: {
  page: number;
  totalPages: number;
  total: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  if (totalPages <= 1) {
    return null;
  }

  function go(next: number) {
    const params = new URLSearchParams(searchParams);
    if (next <= 1) {
      params.delete('page');
    } else {
      params.set('page', String(next));
    }
    const query = params.toString();
    // push, not replace, so the back button steps through pages.
    router.push(query ? `?${query}` : '?');
  }

  return (
    <div className="flex items-center justify-between border-t border-line pt-2 text-sm text-ink-muted">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => go(page - 1)}
        className="rounded-card border border-line px-2 py-1 disabled:opacity-40"
      >
        Previous
      </button>
      <span>
        Page {page} of {totalPages} — {total} product{total === 1 ? '' : 's'}
      </span>
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => go(page + 1)}
        className="rounded-card border border-line px-2 py-1 disabled:opacity-40"
      >
        Next
      </button>
    </div>
  );
}
