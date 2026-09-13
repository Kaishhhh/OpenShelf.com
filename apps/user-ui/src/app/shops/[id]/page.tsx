import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { imagekitUrl } from '@/lib/imagekit-url';
import { parseFilters } from '@/lib/catalogue-filters';
import { fetchShop } from '@/lib/server-api';
import { Pagination } from '@/components/Pagination';
import { EmptyState, ProductGrid } from '@/components/ProductGrid';

export async function generateMetadata({
  params,
}: PageProps<'/shops/[id]'>): Promise<Metadata> {
  const { id } = await params;
  const data = await fetchShop(id);

  if (!data) {
    return { title: 'Shop not found' };
  }

  const { shop } = data;
  const description =
    shop.bio?.slice(0, 200) ?? `${shop.name} on OpenShelf — ${shop.category}.`;
  // The shop's own artwork first, then its newest product as a fallback, so a
  // shop without an avatar still previews as something.
  const image = shop.coverBanner ?? shop.avatar ?? data.products[0]?.images?.[0]?.url;

  return {
    title: `${shop.name} | OpenShelf`,
    description,
    openGraph: {
      title: shop.name,
      description,
      type: 'website',
      ...(image
        ? {
            images: [
              {
                url: imagekitUrl({ src: image, width: 1200, quality: 80 }),
                width: 1200,
                alt: shop.name,
              },
            ],
          }
        : {}),
    },
  };
}

export default async function ShopProfilePage({
  params,
  searchParams,
}: PageProps<'/shops/[id]'>) {
  const { id } = await params;
  // Paging moved from useState into the URL: the server cannot see component
  // state, and this makes page 2 shareable and back-navigable as a bonus.
  const { page } = parseFilters(await searchParams);
  const data = await fetchShop(id, { page });

  // PENDING, REJECTED and missing shops all 404 identically upstream — nothing
  // here reveals that a shop exists but is awaiting review.
  if (!data) {
    notFound();
  }

  const { shop } = data;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1 border-b border-line pb-3">
        <h1 className="text-lg font-semibold text-ink">{shop.name}</h1>
        <p className="text-sm text-ink-muted">
          {shop.category}
          {shop.ratings > 0 ? ` · ${shop.ratings.toFixed(1)} ★` : ''}
          {shop.openingHours ? ` · ${shop.openingHours}` : ''}
        </p>
        {shop.bio && <p className="text-sm text-ink">{shop.bio}</p>}
        {shop.website && (
          <a
            href={shop.website}
            className="text-sm text-accent"
            rel="noreferrer noopener"
            target="_blank"
          >
            {shop.website}
          </a>
        )}
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-ink">
          Products{data.total > 0 ? ` (${data.total})` : ''}
        </h2>
        {data.products.length === 0 ? (
          <EmptyState message="This shop has nothing listed right now." />
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
