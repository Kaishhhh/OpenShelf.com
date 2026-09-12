import { Router } from 'express';
import { isSellerAuthenticated } from '@openshelf/middleware';
import {
  login,
  logout,
  me,
  refreshToken,
  register,
  resendOtp,
  verifyOtp,
} from '../controllers/seller-auth.controller.js';

export const sellerAuthRouter = Router();

sellerAuthRouter.post('/register', register);
sellerAuthRouter.post('/verify-otp', verifyOtp);
sellerAuthRouter.post('/resend-otp', resendOtp);
sellerAuthRouter.post('/login', login);
sellerAuthRouter.post('/refresh-token', refreshToken);
sellerAuthRouter.post('/logout', logout);
sellerAuthRouter.get('/me', isSellerAuthenticated, me);
