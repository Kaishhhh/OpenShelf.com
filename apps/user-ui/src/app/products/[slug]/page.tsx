'use client';

import { useQuery } from '@tanstack/react-query';
import Image from 'next/image';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@openshelf/ui';
import {
  ApiError,
  getPublicProduct,
  type CatalogueProduct,
  type ShopCard,
} from '@/lib/api';
import { Price } from '@/components/Price';
import { EmptyState } from '@/components/ProductGrid';

type PublicProduct = CatalogueProduct & { shop: ShopCard };

export default function ProductDetailPage() {
  const params = useParams<{ slug: string }>();

  const { data, error, isPending } = useQuery<PublicProduct, ApiError>({
    queryKey: ['product', params.slug],
    queryFn: () => getPublicProduct(params.slug),
  });

  if (isPending) {
    return null;
  }

  // A DRAFT or DELETED product, or one whose shop is no longer approved, is a
  // 404 here — indistinguishable from a slug that never existed.
  if (error) {
    return (
      <EmptyState
        message={
          error.status === 404
            ? 'This product is not available.'
            : error.message
        }
      />
    );
  }

  return <ProductDetail product={data} />;
}

function ProductDetail({ product }: { product: PublicProduct }) {
  const [active, setActive] = useState(0);
  const images = product.images ?? [];
  const selected = images[active];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <div className="relative aspect-square w-full overflow-hidden rounded-card border border-line bg-line/30">
            {selected ? (
              <Image
                src={selected.url}
                alt={product.title}
                fill
                sizes="(max-width: 768px) 100vw, 560px"
                className="object-cover"
                priority
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-ink-muted">
                No photo
              </div>
            )}
          </div>

          {images.length > 1 && (
            <div className="grid grid-cols-6 gap-1">
              {images.map((image, index) => (
                <button
                  key={image.id}
                  type="button"
                  onClick={() => setActive(index)}
                  aria-label={`Photo ${index + 1}`}
                  className={`relative aspect-square overflow-hidden rounded-card border ${
                    index === active ? 'border-accent' : 'border-line'
                  }`}
                >
                  <Image
                    src={image.url}
                    alt=""
                    fill
                    sizes="96px"
                    className="object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold text-ink">{product.title}</h1>
            <p className="text-sm text-ink-muted">
              {product.category}
              {product.subCategory ? ` · ${product.subCategory}` : ''}
            </p>
          </div>

          <Price
            price={product.price}
            salePrice={product.salePrice}
            className="text-lg"
          />

          <p className="text-sm text-ink-muted">
            {product.stock > 0
              ? `${product.stock} in stock`
              : 'Currently out of stock'}
          </p>

          <p className="whitespace-pre-line text-sm text-ink">
            {product.description}
          </p>

          {product.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {product.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-card border border-line bg-line/40 px-1.5 py-0.5 text-xs text-ink-muted"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* No cart yet — present so the page reads complete, disabled so it
              cannot imply a capability that does not exist. */}
          <Button type="button" disabled title="Coming soon">
            Add to cart
          </Button>

          <p className="border-t border-line pt-3 text-sm text-ink-muted">
            Sold by{' '}
            <a href={`/shops/${product.shop.id}`} className="text-accent">
              {product.shop.name}
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
