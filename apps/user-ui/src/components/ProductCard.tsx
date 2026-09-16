import Image from 'next/image';
import type { CatalogueProduct } from '@/lib/catalogue-types';
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
        {/* The shop name truncates on its own so a long one can't swallow the status.
            An unpurchasable product is still shown, never hidden — only buying is
            blocked. */}
        <span className="flex min-w-0 text-xs text-ink-muted">
          <span className="truncate">
            {product.shop?.name ?? product.category}
          </span>
          {!product.purchasable ? (
            <span className="shrink-0">&nbsp;· Unavailable to buy</span>
          ) : (
            product.stock === 0 && (
              <span className="shrink-0">&nbsp;· Out of stock</span>
            )
          )}
        </span>
      </div>
    </a>
  );
}
