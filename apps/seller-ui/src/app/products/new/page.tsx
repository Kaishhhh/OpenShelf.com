'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import type { ProductCreateInput } from '@openshelf/types';
import { ApiError, createProduct, type Product } from '@/lib/api';
import { useApprovedShop } from '@/lib/use-approved-shop';
import { ProductForm } from '../ProductForm';

export default function NewProductPage() {
  const { ready } = useApprovedShop();
  const router = useRouter();
  const queryClient = useQueryClient();

  const mutation = useMutation<Product, ApiError, ProductCreateInput>({
    mutationFn: createProduct,
    onSuccess: (product) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      // Straight to the edit page rather than the list: images can only be
      // attached once the product has an id, and that is the next thing a
      // seller wants to do.
      router.push(`/products/${product.id}/edit`);
    },
  });

  if (!ready) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4 rounded-card border border-line bg-surface p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-base font-semibold text-ink">Add a product</h1>
        <p className="text-sm text-ink-muted">
          You can add photos once it is saved.
        </p>
      </div>

      <ProductForm
        submitLabel="Create product"
        pending={mutation.isPending}
        error={mutation.error ?? null}
        onSubmit={(values) => mutation.mutate(values)}
      />

      <p className="text-xs text-ink-muted">
        <a href="/products" className="text-accent">
          Back to products
        </a>
      </p>
    </div>
  );
}
