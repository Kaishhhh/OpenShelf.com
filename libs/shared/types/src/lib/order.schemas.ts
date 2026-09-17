import { z } from 'zod';

/**
 * Checkout and order shapes shared by order-service and user-ui.
 *
 * **Every money value in this module is an integer in minor units (cents).** The cart
 * (cart.schemas.ts) still speaks float dollars because Product.price does; checkout is
 * where the conversion happens, exactly once.
 */

/**
 * GET /order/orders.
 *
 * `paymentIntentId` narrows the list to one checkout — what the success page polls on
 * while it waits for the webhook. Not `.strict()`, like the catalogue queries: an unknown
 * query param is stripped rather than turned into a 400.
 */
export const orderListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
  paymentIntentId: z
    .string()
    .trim()
    .regex(/^pi_[A-Za-z0-9]+$/, 'Invalid payment intent id')
    .optional(),
});

export type OrderListQueryInput = z.infer<typeof orderListQuerySchema>;

export type OrderStatus =
  | 'PENDING'
  | 'PAID'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED';

export interface BuyerOrderItem {
  id: string;
  productId: string;
  title: string;
  /** Cents, as paid. */
  price: number;
  quantity: number;
  /** Cents. */
  lineTotal: number;
  stockShortfall: boolean;
}

/**
 * An order as its buyer sees it.
 *
 * Deliberately without platformFee, sellerAmount, stripeTransferId and transferStatus:
 * how the payment was split between OpenShelf and the seller is not the buyer's record.
 */
export interface BuyerOrder {
  id: string;
  status: OrderStatus;
  /** Cents. */
  subtotal: number;
  stockShortfall: boolean;
  createdAt: string;
  shop: { id: string; name: string };
  /** Orders sharing this came from one checkout. */
  paymentIntentId: string;
  currency: string;
  items: BuyerOrderItem[];
}

export interface OrderPage {
  orders: BuyerOrder[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** POST /order/checkout. */
export interface CheckoutResponse {
  clientSecret: string;
  paymentIntentId: string;
  /** Cents — the total the PaymentIntent was created for. */
  amount: number;
  currency: string;
}
