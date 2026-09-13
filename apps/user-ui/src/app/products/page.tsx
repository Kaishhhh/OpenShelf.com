import { parseFilters } from '@/lib/catalogue-filters';
import { fetchProducts } from '@/lib/server-api';
import { FilterSidebar } from '@/components/FilterSidebar';
import { Pagination } from '@/components/Pagination';
import { EmptyState, ProductGrid } from '@/components/ProductGrid';

export const metadata = {
  title: 'Browse products | OpenShelf',
  description: 'Browse products from independent shops on OpenShelf.',
};

/**
 * The catalogue, rendered on the server from the URL.
 *
 * Reading searchParams makes this route dynamic, which is exactly what is wanted: a
 * shared or crawled filtered URL renders its real results rather than an empty shell
 * that only fills in after hydration.
 */
export default async function ProductsPage({
  searchParams,
}: PageProps<'/products'>) {
  const filters = parseFilters(await searchParams);
  const data = await fetchProducts(filters);

  return (
    <div className="flex gap-4">
      <FilterSidebar />

      <section className="flex min-w-0 flex-1 flex-col gap-2">
        {!data || data.products.length === 0 ? (
          <EmptyState message="No products match these filters." />
        ) : (
          <>
            <ProductGrid products={data.products} />
            <Pagination
              page={data.page}
              totalPages={data.totalPages}
              total={data.total}
            />
          </>
        )}
      </section>
    </div>
  );
}
