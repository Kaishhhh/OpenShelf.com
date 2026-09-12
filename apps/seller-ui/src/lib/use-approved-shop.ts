'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ApiError, getShop, type Shop } from './api';

/**
 * Gate for every page that needs an approved shop.
 *
 * product-service's `requireApprovedShop` 403s a seller whose shop is missing,
 * PENDING or REJECTED regardless — this exists so those sellers see the
 * dashboard that explains their state instead of a form whose submit can only
 * fail.
 *
 * `ready` is false until the answer is known, so callers render nothing rather
 * than flashing a form they are about to be redirected away from.
 */
export function useApprovedShop(): { ready: boolean; shop: Shop | undefined } {
  const router = useRouter();

  const { data, error, isPending } = useQuery<Shop, ApiError>({
    queryKey: ['shop'],
    queryFn: getShop,
    // A seller with no shop 404s, which is an answer rather than a failure.
    retry: false,
  });

  const unauthenticated = error?.status === 401;
  const approved = data?.status === 'APPROVED';
  const blocked = !isPending && !unauthenticated && !approved;

  useEffect(() => {
    if (unauthenticated) {
      router.replace('/login');
    } else if (blocked) {
      router.replace('/dashboard');
    }
  }, [unauthenticated, blocked, router]);

  return { ready: approved, shop: data };
}
