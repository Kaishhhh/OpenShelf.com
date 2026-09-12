'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import type { ProductCreateInput, ProductUpdateInput } from '@openshelf/types';
import { ApiError, getProduct, updateProduct, type Product } from '@/lib/api';
import { useApprovedShop } from '@/lib/use-approved-shop';
import { ProductForm } from '../../ProductForm';
import { ImageManager } from './ImageManager';

export default function EditProductPage() {
  const { ready } = useApprovedShop();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const { data, error, isPending } = useQuery<Product, ApiError>({
    queryKey: ['product', id],
    queryFn: () => getProduct(id),
    retry: false,
    enabled: ready,
  });

  // Nothing renders until the product is loaded: mounting the form first would
  // capture empty defaultValues and the prefill would never appear.
  if (!ready || isPending) {
    return null;
  }

  if (error) {
    return (
      <div className="flex flex-col gap-2 rounded-card border border-line bg-surface p-6">
        <h1 className="text-base font-semibold text-ink">
          {error.status === 404 ? 'Product not found' : 'Something went wrong'}
        </h1>
        <p className="text-sm text-danger">{error.message}</p>
        <p className="text-sm">
          <a href="/products" className="text-accent">
            Back to products
          </a>
        </p>
      </div>
    );
  }

  return <EditForm product={data} />;
}

function EditForm({ product }: { product: Product }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const mutation = useMutation<Product, ApiError, ProductUpdateInput>({
    mutationFn: (body) => updateProduct(product.id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['product', product.id] });
      router.push('/products');
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 rounded-card border border-line bg-surface p-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-base font-semibold text-ink">{product.title}</h1>
          <p className="text-sm text-ink-muted">/{product.slug}</p>
        </div>

        <ProductForm
          product={product}
          submitLabel="Save changes"
          pending={mutation.isPending}
          error={mutation.error ?? null}
          onSubmit={(values, dirty) => {
            // productUpdateSchema is .strict(), so only changed fields may go —
            // sending the whole object would 400 on nothing in particular, and
            // an unchanged body would 400 on "No fields to update".
            const body: Record<string, unknown> = {};
            for (const key of dirty) {
              body[key] = values[key as keyof ProductCreateInput];
            }
            // An emptied sale price clears it; null is how the schema says so.
            if (dirty.has('salePrice') && body.salePrice === undefined) {
              body.salePrice = null;
            }
            if (Object.keys(body).length === 0) {
              router.push('/products');
              return;
            }
            mutation.mutate(body as ProductUpdateInput);
          }}
        />
      </div>

      <div className="rounded-card border border-line bg-surface p-6">
        <ImageManager productId={product.id} images={product.images ?? []} />
      </div>

      <p className="text-xs text-ink-muted">
        <a href="/products" className="text-accent">
          Back to products
        </a>
      </p>
    </div>
  );
}
