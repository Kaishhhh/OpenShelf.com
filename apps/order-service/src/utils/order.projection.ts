import { prisma } from '@openshelf/prisma';
import type { BuyerOrderItem } from '@openshelf/types';

/**
 * Pieces shared by the buyer and seller order views.
 *
 * Both project explicitly — never an `include` of the whole row — so a column added to
 * Order later is not exposed to either side until someone decides it should be.
 */

export const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;

export const ORDER_NOT_FOUND_MESSAGE = 'Order not found';

/** The order's own items only. OrderItem is scoped by orderId, never by product or buyer. */
export const ORDER_ITEM_SELECT = {
  id: true,
  productId: true,
  title: true,
  price: true,
  quantity: true,
  lineTotal: true,
  stockShortfall: true,
} as const;

export const ORDER_TIMESTAMPS_SELECT = {
  createdAt: true,
  shippedAt: true,
  deliveredAt: true,
  cancelledAt: true,
} as const;

export type SelectedItem = Omit<BuyerOrderItem, 'image'>;

export interface SelectedTimestamps {
  createdAt: Date;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
}

export function toIsoTimestamps(t: SelectedTimestamps) {
  return {
    createdAt: t.createdAt.toISOString(),
    shippedAt: t.shippedAt?.toISOString() ?? null,
    deliveredAt: t.deliveredAt?.toISOString() ?? null,
    cancelledAt: t.cancelledAt?.toISOString() ?? null,
  };
}

/**
 * The current first image of every product in `items`, in one query for the whole
 * response.
 *
 * Looked up live rather than snapshotted onto OrderItem: deleting a product purges its
 * ImageKit files, so a stored URL would break anyway. A product that is gone simply has
 * no image — the title and price on the item remain the historical record. Images are
 * public catalogue data, so reading them across shops leaks nothing.
 */
export async function imagesFor(
  items: { productId: string }[]
): Promise<Map<string, string>> {
  const productIds = [...new Set(items.map((item) => item.productId))];
  if (productIds.length === 0) {
    return new Map();
  }

  const images = await prisma.image.findMany({
    where: { productId: { in: productIds } },
    select: { productId: true, url: true },
  });

  const first = new Map<string, string>();
  for (const image of images) {
    if (image.productId && !first.has(image.productId)) {
      first.set(image.productId, image.url);
    }
  }
  return first;
}

export function withImages(
  items: SelectedItem[],
  images: Map<string, string>
): BuyerOrderItem[] {
  return items.map((item) => ({ ...item, image: images.get(item.productId) ?? null }));
}
