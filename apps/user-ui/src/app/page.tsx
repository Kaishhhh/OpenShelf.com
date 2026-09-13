import { CATEGORIES } from '@openshelf/types';
import { fetchRecentProducts } from '@/lib/server-api';
import { EmptyState, ProductGrid } from '@/components/ProductGrid';

/**
 * Rendered per request rather than prerendered at build time.
 *
 * With no dynamic params this route is otherwise a static candidate, which would make
 * `nx build` fetch from product-service — a build that fails when the service is not
 * running, and bakes whatever it found into the HTML. The work is still cached: the
 * fetch carries a 60s revalidate, so a request here is a cache read rather than a
 * database query.
 */
export const dynamic = 'force-dynamic';

export default async function LandingPage() {
  const data = await fetchRecentProducts(8);

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

        {!data || data.products.length === 0 ? (
          <EmptyState message="Nothing listed yet. Check back soon." />
        ) : (
          <ProductGrid products={data.products} />
        )}
      </section>
    </div>
  );
}
