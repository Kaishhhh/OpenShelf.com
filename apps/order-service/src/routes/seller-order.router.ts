import { Router } from 'express';
import {
  isSellerAuthenticated,
  requireApprovedShop,
} from '@openshelf/middleware';
import {
  getShopOrder,
  listShopOrders,
  updateOrderStatus,
} from '../controllers/seller-order.controller.js';

/**
 * A shop's view of its own orders. The shop is always the authenticated seller's approved
 * shop (req.shop) — no route here takes a shop id from the client.
 *
 * Guards are per route, not `router.use`, for the reason given in order.router.ts: a
 * router-level guard on a router mounted at '/api' runs for every '/api' request that
 * reaches it.
 *
 * A buyer's access_token 401s at isSellerAuthenticated, which checks the token's role.
 */
export const sellerOrderRouter = Router();

const sellerOnly = [isSellerAuthenticated, requireApprovedShop];

sellerOrderRouter.get('/seller/orders', ...sellerOnly, listShopOrders);
sellerOrderRouter.get('/seller/orders/:id', ...sellerOnly, getShopOrder);
sellerOrderRouter.patch('/seller/orders/:id/status', ...sellerOnly, updateOrderStatus);
