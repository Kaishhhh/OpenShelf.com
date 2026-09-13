'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { CATEGORIES, PRODUCT_SORTS } from '@openshelf/types';
import { hasActiveFilters, parseFilters } from '@/lib/catalogue-filters';

const SORT_LABELS: Record<(typeof PRODUCT_SORTS)[number], string> = {
  newest: 'Newest',
  'price-asc': 'Price: low to high',
  'price-desc': 'Price: high to low',
};

/**
 * The one interactive island on the catalogue.
 *
 * It holds no data and no copy of the filter state — it reads the URL and writes the
 * URL, and the server component re-renders with new results on navigation. That is what
 * keeps a filtered view shareable and crawlable while the controls stay interactive.
 */
export function FilterSidebar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const filters = parseFilters(new URLSearchParams(searchParams));

  function setParam(key: string, value: string | number | undefined) {
    const next = new URLSearchParams(searchParams);
    if (value === undefined || value === '') {
      next.delete(key);
    } else {
      next.set(key, String(value));
    }
    // Any filter change invalidates the current page number.
    if (key !== 'page') {
      next.delete('page');
    }
    const query = next.toString();
    // push, not replace: each filter change is its own history entry, which is
    // what makes the back button step back through previous filter states
    // rather than leaving the page entirely.
    router.push(query ? `/products?${query}` : '/products');
  }

  return (
    <aside className="flex w-48 shrink-0 flex-col gap-4 text-sm">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
          Category
        </span>
        <button
          type="button"
          onClick={() => setParam('category', undefined)}
          className={`text-left ${
            filters.category ? 'text-ink-muted hover:text-ink' : 'text-accent'
          }`}
        >
          All
        </button>
        {CATEGORIES.map((category) => (
          <button
            key={category}
            type="button"
            onClick={() => setParam('category', category)}
            className={`text-left ${
              filters.category === category
                ? 'text-accent'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            {category}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
          Price
        </span>
        <div className="flex items-center gap-1">
          <input
            type="number"
            min="0"
            placeholder="Min"
            // key so a back navigation re-mounts the input with the restored
            // value; an uncontrolled defaultValue alone would keep the old one.
            key={`min-${filters.minPrice ?? ''}`}
            defaultValue={filters.minPrice ?? ''}
            onBlur={(e) => setParam('minPrice', e.target.value)}
            className="w-full rounded-card border border-line bg-surface px-1.5 py-1 text-sm text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
          />
          <span className="text-ink-muted">–</span>
          <input
            type="number"
            min="0"
            placeholder="Max"
            key={`max-${filters.maxPrice ?? ''}`}
            defaultValue={filters.maxPrice ?? ''}
            onBlur={(e) => setParam('maxPrice', e.target.value)}
            className="w-full rounded-card border border-line bg-surface px-1.5 py-1 text-sm text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
          Sort
        </span>
        {PRODUCT_SORTS.map((sort) => (
          <button
            key={sort}
            type="button"
            onClick={() => setParam('sort', sort)}
            className={`text-left ${
              (filters.sort ?? 'newest') === sort
                ? 'text-accent'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            {SORT_LABELS[sort]}
          </button>
        ))}
      </div>

      {hasActiveFilters(filters) && (
        <a href="/products" className="text-accent">
          Clear filters
        </a>
      )}
    </aside>
  );
}
