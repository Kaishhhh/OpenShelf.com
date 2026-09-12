import { Router } from 'express';
import { isAuthenticated } from '@openshelf/middleware';
import {
  login,
  logout,
  me,
  refreshToken,
  register,
  resendOtp,
  verifyOtp,
} from '../controllers/auth.controller.js';

export const authRouter = Router();

authRouter.post('/register', register);
authRouter.post('/verify-otp', verifyOtp);
authRouter.post('/resend-otp', resendOtp);
authRouter.post('/login', login);
authRouter.post('/refresh-token', refreshToken);
authRouter.post('/logout', logout);
authRouter.get('/me', isAuthenticated, me);
