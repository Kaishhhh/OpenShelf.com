import { Router } from 'express';
import { isAuthenticated } from '@openshelf/middleware';
import {
  addCartItem,
  deleteCart,
  deleteCartItem,
  getCart,
  updateCartItem,
} from '../controllers/cart.controller.js';

/**
 * Every route is a buyer's own cart, keyed on req.user.id — nothing here takes a user
 * id from the request, so one buyer cannot address another's cart.
 *
 * isAuthenticated looks the id up in User, so a seller's token 401s here.
 */
export const cartRouter = Router();

cartRouter.use(isAuthenticated);

cartRouter.get('/cart', getCart);
cartRouter.post('/cart/items', addCartItem);
cartRouter.patch('/cart/items/:productId', updateCartItem);
cartRouter.delete('/cart/items/:productId', deleteCartItem);
cartRouter.delete('/cart', deleteCart);
