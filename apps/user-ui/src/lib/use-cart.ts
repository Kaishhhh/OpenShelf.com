'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import type { CartResponse } from '@openshelf/types';
import {
  ApiError,
  addCartItem,
  clearCart,
  getCart,
  removeCartItem,
  updateCartItem,
} from './api';

/**
 * One query key for the whole cart.
 *
 * Every mutation writes the server's response straight into it, so the header badge and
 * the cart page stay in step without either refetching — and without the badge needing
 * an endpoint of its own.
 */
export const CART_KEY = ['cart'] as const;

/**
 * The cart, or `undefined` for a visitor who is not logged in.
 *
 * A 401 is an answer, not a failure: there is no anonymous cart, so the badge renders
 * bare rather than showing an error. `retry: false` keeps that from costing three round
 * trips on every page load.
 */
export function useCart() {
  const query = useQuery<CartResponse, ApiError>({
    queryKey: CART_KEY,
    queryFn: getCart,
    retry: false,
  });

  return {
    ...query,
    anonymous: query.error?.status === 401,
  };
}

/** Shared by every mutation below: the response *is* the new cart. */
function useCartMutation<TVariables>(
  mutationFn: (variables: TVariables) => Promise<CartResponse>
): UseMutationResult<CartResponse, ApiError, TVariables> {
  const queryClient = useQueryClient();

  return useMutation<CartResponse, ApiError, TVariables>({
    mutationFn,
    onSuccess: (cart) => queryClient.setQueryData(CART_KEY, cart),
  });
}

export const useAddToCart = () =>
  useCartMutation<{ productId: string; quantity?: number }>(addCartItem);

export const useUpdateCartItem = () =>
  useCartMutation<{ productId: string; quantity: number }>(
    ({ productId, quantity }) => updateCartItem(productId, quantity)
  );

export const useRemoveCartItem = () =>
  useCartMutation<string>((productId) => removeCartItem(productId));

export const useClearCart = () => useCartMutation<void>(() => clearCart());
