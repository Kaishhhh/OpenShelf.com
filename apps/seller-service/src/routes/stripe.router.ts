import { Router } from 'express';
import { isSellerAuthenticated } from '@openshelf/middleware';
import {
  getStripeStatus,
  startStripeOnboarding,
} from '../controllers/stripe.controller.js';

// The webhook is not here. It needs the raw body, so main.ts mounts it on its
// own ahead of express.json(), which runs before this router.
export const stripeRouter = Router();

stripeRouter.post('/stripe/onboard', isSellerAuthenticated, startStripeOnboarding);
stripeRouter.get('/stripe/status', isSellerAuthenticated, getStripeStatus);
