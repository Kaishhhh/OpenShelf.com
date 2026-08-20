import { Router } from 'express';
import { isAdminAuthenticated } from '@openshelf/middleware';
import {
  approveShop,
  listShops,
  rejectShop,
} from '../controllers/shop-moderation.controller.js';

export const shopModerationRouter = Router();

shopModerationRouter.get('/shops', isAdminAuthenticated, listShops);
shopModerationRouter.patch(
  '/shops/:id/approve',
  isAdminAuthenticated,
  approveShop
);
shopModerationRouter.patch(
  '/shops/:id/reject',
  isAdminAuthenticated,
  rejectShop
);
