import { z } from 'zod';
import { ORDER_STATUSES, type OrderStatus } from './order-status';

export type { OrderStatus };

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
  /**
   * The product's current first image, looked up at read time. Null once the product or
   * its images are gone — the title and price above are the historical record, not this.
   */
  image: string | null;
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
  /** When payment was confirmed — orders are only created at that moment. */
  createdAt: string;
  shippedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
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

// --- seller side ----------------------------------------------------------

/** GET /order/seller/orders. The shop always comes from the session, never the query. */
export const sellerOrderListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  status: z.enum(ORDER_STATUSES).optional(),
});

export type SellerOrderListQueryInput = z.infer<typeof sellerOrderListQuerySchema>;

/**
 * PATCH /order/seller/orders/:id/status.
 *
 * Accepts every status, including ones a seller can never move to. Legality is the state
 * machine's decision, not the schema's, so `PAID` or `PENDING` gets the same 400 naming
 * the current and attempted status as any other illegal move — not a generic validation
 * error.
 */
export const orderStatusUpdateSchema = z
  .object({ status: z.enum(ORDER_STATUSES) })
  .strict();

export type OrderStatusUpdateInput = z.infer<typeof orderStatusUpdateSchema>;

/**
 * An order as its shop sees it.
 *
 * Carries the split — platformFee and sellerAmount are the seller's own money — and the
 * payout's state. Deliberately without the buyer's id, email or payment identifiers: the
 * PaymentIntent id is what ties a buyer's orders at *other* shops together, so a seller
 * never receives it.
 */
export interface SellerOrder {
  id: string;
  status: OrderStatus;
  /** Cents. */
  subtotal: number;
  /** Cents — OpenShelf's commission on this order. */
  platformFee: number;
  /** Cents — what this shop is paid. */
  sellerAmount: number;
  transferStatus: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  stockShortfall: boolean;
  currency: string;
  createdAt: string;
  shippedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  buyer: { name: string };
  items: BuyerOrderItem[];
}

export interface SellerOrderPage {
  orders: SellerOrder[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** PATCH response: the updated order, and whether money now needs to move back. */
export interface OrderStatusUpdateResponse {
  order: SellerOrder;
  /**
   * True once an order is CANCELLED. Refunds are not implemented; this marks that the
   * buyer has paid for an order that will not be fulfilled.
   */
  refundRequired: boolean;
}
