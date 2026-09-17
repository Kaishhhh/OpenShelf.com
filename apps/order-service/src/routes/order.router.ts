import { Router } from 'express';
import { isAuthenticated } from '@openshelf/middleware';
import { startCheckout } from '../controllers/checkout.controller.js';
import { getOrder, listOrders } from '../controllers/order.controller.js';

/**
 * Checkout and the buyer's order history. Every route is the caller's own, keyed on
 * req.user.id.
 *
 * isAuthenticated is applied per route rather than with `router.use`. A router-level
 * `use` on a router mounted at '/api' runs for every '/api' request that reaches it —
 * including ones meant for routers mounted later — which is exactly how cartRouter would
 * 401 the webhook if the webhook were mounted after it.
 *
 * The webhook is not here: it needs the raw body, so main.ts mounts it on its own.
 */
export const orderRouter = Router();

orderRouter.post('/checkout', isAuthenticated, startCheckout);
orderRouter.get('/orders', isAuthenticated, listOrders);
orderRouter.get('/orders/:id', isAuthenticated, getOrder);
