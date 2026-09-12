import { Router } from 'express';
import { getPublicShop } from '../controllers/product.controller.js';

/**
 * Buyer-facing shop reads. Unauthenticated by design — this is the storefront.
 *
 * Lives in product-service rather than seller-service because the response is
 * mostly Product data, and this service already owns the Product-Shop join.
 */
export const shopPublicRouter = Router();

shopPublicRouter.get('/public/:id', getPublicShop);
