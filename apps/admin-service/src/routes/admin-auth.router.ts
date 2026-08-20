import { Router } from 'express';
import { isAdminAuthenticated } from '@openshelf/middleware';
import {
  login,
  logout,
  me,
  refreshToken,
} from '../controllers/admin-auth.controller.js';

export const adminAuthRouter = Router();

adminAuthRouter.post('/login', login);
adminAuthRouter.post('/refresh-token', refreshToken);
adminAuthRouter.post('/logout', logout);
adminAuthRouter.get('/me', isAdminAuthenticated, me);
