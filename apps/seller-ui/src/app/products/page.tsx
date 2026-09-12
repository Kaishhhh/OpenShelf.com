'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@openshelf/ui';
import {
  ApiError,
  deleteProduct,
  listMyProducts,
  type Product,
  type ProductPage,
} from '@/lib/api';
import { useApprovedShop } from '@/lib/use-approved-shop';

function money(value: number) {
  return `$${value.toFixed(2)}`;
}

function StatusBadge({ status }: { status: Product['status'] }) {
  const tone =
    status === 'ACTIVE' ? 'text-accent border-accent' : 'text-ink-muted border-line';
  return (
    <span className={`rounded-card border px-1.5 py-0.5 text-xs ${tone}`}>
      {status}
    </span>
  );
}

export default function ProductsPage() {
  const { ready } = useApprovedShop();
  const [page, setPage] = useState(1);

  if (!ready) {
    return null;
  }

  return <ProductList page={page} onPage={setPage} />;
}

function ProductList({
  page,
  onPage,
}: {
  page: number;
  onPage: (p: number) => void;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<string | null>(null);

  const { data, error, isPending } = useQuery<ProductPage, ApiError>({
    queryKey: ['products', page],
    queryFn: () => listMyProducts(page),
  });

  const remove = useMutation({
    mutationFn: deleteProduct,
    onSuccess: () => {
      setConfirming(null);
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });

  if (isPending) {
    return null;
  }

  if (error) {
    return (
      <p className="rounded-card border border-line bg-surface p-6 text-sm text-danger">
        {error.message}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-semibold text-ink">Products</h1>
        <a
          href="/products/new"
          className="rounded-card bg-accent px-3 py-1.5 text-sm font-medium text-surface hover:bg-accent-hover"
        >
          Add product
        </a>
      </div>

      {data.products.length === 0 ? (
        <div className="flex flex-col gap-2 rounded-card border border-line bg-surface p-6">
          <p className="text-sm text-ink">You have no products yet.</p>
          <p className="text-sm">
            <a href="/products/new" className="text-accent">
              Add your first product
            </a>
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-card border border-line bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-muted">
                <th className="p-3 font-medium">Product</th>
                <th className="p-3 font-medium">Price</th>
                <th className="p-3 font-medium">Stock</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {data.products.map((product) => (
                <tr key={product.id} className="border-b border-line last:border-0">
                  <td className="p-3">
                    <div className="flex items-center gap-3">
                      {product.images?.[0] ? (
                        <img
                          src={product.images[0].url}
                          alt=""
                          className="h-10 w-10 rounded-card border border-line object-cover"
                        />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-card border border-line text-xs text-ink-muted">
                          —
                        </div>
                      )}
                      <span className="text-ink">{product.title}</span>
                    </div>
                  </td>
                  <td className="p-3">
                    {product.salePrice != null ? (
                      <span>
                        <span className="text-ink">{money(product.salePrice)}</span>{' '}
                        <span className="text-ink-muted line-through">
                          {money(product.price)}
                        </span>
                      </span>
                    ) : (
                      <span className="text-ink">{money(product.price)}</span>
                    )}
                  </td>
                  <td className="p-3 text-ink">{product.stock}</td>
                  <td className="p-3">
                    <StatusBadge status={product.status} />
                  </td>
                  <td className="p-3">
                    {confirming === product.id ? (
                      // Inline rather than window.confirm: a native dialog blocks
                      // the page and cannot be styled or tested.
                      <div className="flex items-center justify-end gap-2">
                        <span className="text-xs text-ink-muted">Remove?</span>
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate(product.id)}
                        >
                          {remove.isPending ? 'Removing…' : 'Yes'}
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => setConfirming(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-3">
                        <a
                          href={`/products/${product.id}/edit`}
                          className="text-sm text-accent"
                        >
                          Edit
                        </a>
                        <button
                          type="button"
                          className="text-sm text-ink-muted hover:text-danger"
                          onClick={() => setConfirming(product.id)}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {remove.isError && (
        <p className="text-xs text-danger">
          {(remove.error as ApiError).message}
        </p>
      )}

      {data.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-ink-muted">
          <Button
            type="button"
            variant="secondary"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
          >
            Previous
          </Button>
          <span>
            Page {data.page} of {data.totalPages} — {data.total} total
          </span>
          <Button
            type="button"
            variant="secondary"
            disabled={page >= data.totalPages}
            onClick={() => onPage(page + 1)}
          >
            Next
          </Button>
        </div>
      )}

      <p className="text-xs text-ink-muted">
        <a href="/dashboard" className="text-accent">
          Back to dashboard
        </a>
      </p>
    </div>
  );
}
