import { Router } from 'express';
import { isSellerAuthenticated } from '@openshelf/middleware';
import { createShop, getShop } from '../controllers/shop.controller.js';

export const shopRouter = Router();

shopRouter.post('/shop', isSellerAuthenticated, createShop);
shopRouter.get('/shop', isSellerAuthenticated, getShop);
