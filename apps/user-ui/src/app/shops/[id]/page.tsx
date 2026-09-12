'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ApiError, getPublicShop, type ShopPage } from '@/lib/api';
import { EmptyState, Pagination, ProductGrid } from '@/components/ProductGrid';

export default function ShopProfilePage() {
  const params = useParams<{ id: string }>();
  const [page, setPage] = useState(1);

  const { data, error, isPending } = useQuery<ShopPage, ApiError>({
    queryKey: ['shop', params.id, page],
    queryFn: () => getPublicShop(params.id, { page }),
  });

  if (isPending) {
    return null;
  }

  // PENDING, REJECTED and missing shops all 404 identically — nothing here
  // reveals that a shop exists but is awaiting review.
  if (error) {
    return (
      <EmptyState
        message={
          error.status === 404 ? 'This shop is not available.' : error.message
        }
      />
    );
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
              onPage={setPage}
            />
          </>
        )}
      </section>
    </div>
  );
}
