import type { CatalogueProduct } from '@/lib/catalogue-types';
import { ProductCard } from './ProductCard';

export function ProductGrid({ products }: { products: CatalogueProduct[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-card border border-line bg-surface p-6 text-sm text-ink-muted">
      {message}
    </div>
  );
}
