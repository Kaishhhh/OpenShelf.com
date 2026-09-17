import { Router } from 'express';
import { isAuthenticated, isSellerAuthenticated } from '@openshelf/middleware';
import {
  listSellerNotifications,
  listUserNotifications,
  markAllSellerNotificationsRead,
  markAllUserNotificationsRead,
  markSellerNotificationRead,
  markUserNotificationRead,
  registerSellerToken,
  registerUserToken,
  removeSellerToken,
  removeUserToken,
} from '../controllers/notification.controller.js';

/**
 * Guards are per route, not `router.use`: a router-level guard on a router mounted at
 * '/api' runs for every '/api' request that reaches it, which would 401 a seller on the
 * buyer's guard before the seller route was ever matched.
 *
 * Buyer routes sit at the root, seller routes under /seller — the same split as
 * order-service. Every handler scopes to the authenticated caller.
 */
export const notificationRouter = Router();

notificationRouter.get('/notifications', isAuthenticated, listUserNotifications);
notificationRouter.post('/notifications/read-all', isAuthenticated, markAllUserNotificationsRead);
notificationRouter.patch('/notifications/:id/read', isAuthenticated, markUserNotificationRead);
notificationRouter.post('/fcm-tokens', isAuthenticated, registerUserToken);
notificationRouter.delete('/fcm-tokens', isAuthenticated, removeUserToken);

notificationRouter.get('/seller/notifications', isSellerAuthenticated, listSellerNotifications);
notificationRouter.post(
  '/seller/notifications/read-all',
  isSellerAuthenticated,
  markAllSellerNotificationsRead
);
notificationRouter.patch(
  '/seller/notifications/:id/read',
  isSellerAuthenticated,
  markSellerNotificationRead
);
notificationRouter.post('/seller/fcm-tokens', isSellerAuthenticated, registerSellerToken);
notificationRouter.delete('/seller/fcm-tokens', isSellerAuthenticated, removeSellerToken);
