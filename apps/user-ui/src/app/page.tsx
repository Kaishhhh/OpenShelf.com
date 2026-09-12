'use client';

import { useQuery } from '@tanstack/react-query';
import { CATEGORIES } from '@openshelf/types';
import { ApiError, listPublicProducts, type CataloguePage } from '@/lib/api';
import { EmptyState, ProductGrid } from '@/components/ProductGrid';

export default function LandingPage() {
  const { data, error, isPending } = useQuery<CataloguePage, ApiError>({
    queryKey: ['catalogue', { recent: true }],
    queryFn: () => listPublicProducts({ limit: 8, sort: 'newest' }),
  });

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h1 className="text-base font-semibold text-ink">Browse by category</h1>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
          {CATEGORIES.map((category) => (
            <a
              key={category}
              href={`/products?category=${encodeURIComponent(category)}`}
              className="rounded-card border border-line bg-surface px-3 py-2 text-sm text-ink hover:border-accent hover:text-accent"
            >
              {category}
            </a>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold text-ink">New arrivals</h2>
          <a href="/products" className="text-sm text-accent">
            See all
          </a>
        </div>

        {isPending ? null : error ? (
          <EmptyState message={error.message} />
        ) : data.products.length === 0 ? (
          <EmptyState message="Nothing listed yet. Check back soon." />
        ) : (
          <ProductGrid products={data.products} />
        )}
      </section>
    </div>
  );
}
