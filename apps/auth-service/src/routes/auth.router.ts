import { Router } from 'express';
import { register, verifyOtp } from '../controllers/auth.controller.js';

export const authRouter = Router();

authRouter.post('/register', register);
authRouter.post('/verify-otp', verifyOtp);
