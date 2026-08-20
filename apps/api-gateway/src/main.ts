import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { errorMiddleware, RateLimitError } from '@openshelf/errors';

const app = express();

app.set('trust proxy', 1);

app.use(
  cors({
    origin: [
      process.env.USER_UI_URL || 'http://localhost:3000',
      process.env.SELLER_UI_URL || 'http://localhost:3001',
    ],
    credentials: true,
  })
);

app.use(cookieParser());

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: (req) => (req.cookies?.access_token ? 1000 : 100),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res, next) => next(new RateLimitError()),
  })
);

const AUTH_SERVICE_URL =
  process.env.AUTH_SERVICE_URL || 'http://localhost:6001';
const SELLER_SERVICE_URL =
  process.env.SELLER_SERVICE_URL || 'http://localhost:6003';
const ADMIN_SERVICE_URL =
  process.env.ADMIN_SERVICE_URL || 'http://localhost:6007';

app.use(
  '/auth',
  createProxyMiddleware({
    target: `${AUTH_SERVICE_URL}/api`,
    changeOrigin: true,
  })
);

app.use(
  '/seller',
  createProxyMiddleware({
    target: `${SELLER_SERVICE_URL}/api`,
    changeOrigin: true,
  })
);

app.use(
  '/admin',
  createProxyMiddleware({
    target: `${ADMIN_SERVICE_URL}/api`,
    changeOrigin: true,
  })
);

app.use(errorMiddleware);

const port = process.env.PORT || 8080;
const server = app.listen(port, () => {
  console.log(`Listening at http://localhost:${port}`);
});
server.on('error', console.error);
