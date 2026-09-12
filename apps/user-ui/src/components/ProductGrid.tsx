import type { CatalogueProduct } from '@/lib/api';
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

export function Pagination({
  page,
  totalPages,
  total,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPage: (next: number) => void;
}) {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <div className="flex items-center justify-between border-t border-line pt-2 text-sm text-ink-muted">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        className="rounded-card border border-line px-2 py-1 disabled:opacity-40"
      >
        Previous
      </button>
      <span>
        Page {page} of {totalPages} — {total} product{total === 1 ? '' : 's'}
      </span>
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
        className="rounded-card border border-line px-2 py-1 disabled:opacity-40"
      >
        Next
      </button>
    </div>
  );
}
