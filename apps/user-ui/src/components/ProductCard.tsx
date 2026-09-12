import Image from 'next/image';
import type { CatalogueProduct } from '@/lib/api';
import { Price } from './Price';

/**
 * A catalogue tile. Deliberately compact — the grid is meant to show many
 * products at once rather than a few large ones.
 */
export function ProductCard({ product }: { product: CatalogueProduct }) {
  const image = product.images?.[0];

  return (
    <a
      href={`/products/${product.slug}`}
      className="flex flex-col overflow-hidden rounded-card border border-line bg-surface hover:border-accent"
    >
      <div className="relative aspect-square w-full bg-line/30">
        {image ? (
          <Image
            src={image.url}
            alt={product.title}
            fill
            // The grid is 2 up on phones and 4 up past 768px, so the rendered
            // width never exceeds a quarter of the 1152px container.
            sizes="(max-width: 768px) 50vw, 288px"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-ink-muted">
            No photo
          </div>
        )}
      </div>

      <div className="flex flex-col gap-0.5 p-2">
        <span className="truncate text-sm text-ink" title={product.title}>
          {product.title}
        </span>
        <Price
          price={product.price}
          salePrice={product.salePrice}
          className="text-sm"
        />
        <span className="truncate text-xs text-ink-muted">
          {product.shop?.name ?? product.category}
          {product.stock === 0 && ' · Out of stock'}
        </span>
      </div>
    </a>
  );
}
