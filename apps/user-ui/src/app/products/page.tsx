'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { CATEGORIES, PRODUCT_SORTS, type Category } from '@openshelf/types';
import {
  ApiError,
  listPublicProducts,
  type CatalogueFilters,
  type CataloguePage,
} from '@/lib/api';
import { EmptyState, Pagination, ProductGrid } from '@/components/ProductGrid';

const SORT_LABELS: Record<(typeof PRODUCT_SORTS)[number], string> = {
  newest: 'Newest',
  'price-asc': 'Price: low to high',
  'price-desc': 'Price: high to low',
};

/**
 * The URL is the single source of truth for the filters.
 *
 * Reading them back out of searchParams rather than from component state is what makes a
 * filtered view shareable and back/forward work — the browser restores the URL, and the
 * query key derived from it refetches.
 */
function filtersFromParams(params: URLSearchParams): CatalogueFilters {
  const num = (key: string) => {
    const raw = params.get(key);
    if (raw === null || raw === '') return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  };

  const category = params.get('category');
  const sort = params.get('sort');

  return {
    page: num('page') ?? 1,
    category:
      category && (CATEGORIES as readonly string[]).includes(category)
        ? (category as Category)
        : undefined,
    minPrice: num('minPrice'),
    maxPrice: num('maxPrice'),
    shopId: params.get('shopId') ?? undefined,
    sort:
      sort && (PRODUCT_SORTS as readonly string[]).includes(sort)
        ? (sort as CatalogueFilters['sort'])
        : undefined,
  };
}

export default function ProductsPage() {
  // useSearchParams needs a Suspense boundary or the Next build fails on the
  // client-side-rendering bailout.
  return (
    <Suspense fallback={null}>
      <Catalogue />
    </Suspense>
  );
}

function Catalogue() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const filters = filtersFromParams(new URLSearchParams(searchParams));

  /** Writes one filter back to the URL; the query follows from there. */
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

  const { data, error, isPending } = useQuery<CataloguePage, ApiError>({
    queryKey: ['catalogue', filters],
    queryFn: () => listPublicProducts(filters),
  });

  return (
    <div className="flex gap-4">
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
              defaultValue={filters.minPrice ?? ''}
              onBlur={(e) => setParam('minPrice', e.target.value)}
              className="w-full rounded-card border border-line bg-surface px-1.5 py-1 text-sm text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
            />
            <span className="text-ink-muted">–</span>
            <input
              type="number"
              min="0"
              placeholder="Max"
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

        {(filters.category ||
          filters.minPrice !== undefined ||
          filters.maxPrice !== undefined ||
          filters.shopId) && (
          <a href="/products" className="text-accent">
            Clear filters
          </a>
        )}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col gap-2">
        {isPending ? null : error ? (
          <EmptyState message={error.message} />
        ) : data.products.length === 0 ? (
          <EmptyState message="No products match these filters." />
        ) : (
          <>
            <ProductGrid products={data.products} />
            <Pagination
              page={data.page}
              totalPages={data.totalPages}
              total={data.total}
              onPage={(next) => setParam('page', next)}
            />
          </>
        )}
      </section>
    </div>
  );
}
