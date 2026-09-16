'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@openshelf/ui';
import { loginUrl } from '@/lib/return-to';
import { useAddToCart } from '@/lib/use-cart';

/**
 * The buy control on a product page — the one interactive island on an otherwise
 * server-rendered route.
 *
 * There is deliberately **no auth pre-check**. It attempts the POST and reads a 401 as
 * "log in first", which costs one round trip on the rare anonymous add instead of a
 * session probe on every product page view.
 */
export function AddToCart({
  productId,
  slug,
  stock,
  purchasable,
}: {
  productId: string;
  slug: string;
  stock: number;
  purchasable: boolean;
}) {
  const router = useRouter();
  const mutation = useAddToCart();

  // Checked before stock: restocking would not make this buyable, so "Out of stock"
  // would be the wrong reason to give.
  if (!purchasable) {
    return (
      <Button type="button" disabled>
        Not currently available for purchase
      </Button>
    );
  }

  if (stock === 0) {
    return (
      <Button type="button" disabled>
        Out of stock
      </Button>
    );
  }

  function add() {
    mutation.mutate(
      { productId, quantity: 1 },
      {
        onError: (error) => {
          if (error.status === 401) {
            router.push(loginUrl(`/products/${slug}`));
          }
        },
      }
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Button type="button" onClick={add} loading={mutation.isPending}>
        Add to cart
      </Button>

      {mutation.isSuccess && (
        <p className="text-xs text-ink-muted">
          Added.{' '}
          <a href="/cart" className="text-accent">
            View cart
          </a>
        </p>
      )}

      {/* A 401 is already being redirected on, so it would only flash here. */}
      {mutation.isError && mutation.error.status !== 401 && (
        <p className="text-xs text-danger">{mutation.error.message}</p>
      )}
    </div>
  );
}
