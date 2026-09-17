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
    // Stripe's webhooks carry no access_token, so it would share the 100/min
    // anonymous bucket across the handful of IPs Stripe sends from, and a burst
    // of retries would 429 itself. The route authenticates by signature instead.
    // The notification socket is one long-lived connection per tab, not request traffic.
    skip: (req) =>
      req.path.startsWith('/notification/socket.io') ||
      (req.method === 'POST' &&
        (req.path === '/seller/stripe/webhook' || req.path === '/order/webhook')),
    handler: (req, res, next) => next(new RateLimitError()),
  })
);

const AUTH_SERVICE_URL =
  process.env.AUTH_SERVICE_URL || 'http://localhost:6001';
const SELLER_SERVICE_URL =
  process.env.SELLER_SERVICE_URL || 'http://localhost:6003';
const ADMIN_SERVICE_URL =
  process.env.ADMIN_SERVICE_URL || 'http://localhost:6007';
const PRODUCT_SERVICE_URL =
  process.env.PRODUCT_SERVICE_URL || 'http://localhost:6002';
const ORDER_SERVICE_URL =
  process.env.ORDER_SERVICE_URL || 'http://localhost:6004';
const NOTIFICATION_SERVICE_URL =
  process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:6005';

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

// Target is /api/product, not /api like the routes above. Express strips the
// '/product' mount before the proxy sees the request, so an /api target would
// forward /product/mine as /api/mine.
app.use(
  '/product',
  createProxyMiddleware({
    target: `${PRODUCT_SERVICE_URL}/api/product`,
    changeOrigin: true,
  })
);

// Public storefront shop reads, served by product-service. Same suffix rule as
// '/product' above: Express strips the mount before the proxy sees the request.
app.use(
  '/shop',
  createProxyMiddleware({
    target: `${PRODUCT_SERVICE_URL}/api/shop`,
    changeOrigin: true,
  })
);

// Back to the bare /api target: order-service mounts its router at /api with
// unprefixed paths, so /order/cart arrives as /api/cart.
app.use(
  '/order',
  createProxyMiddleware({
    target: `${ORDER_SERVICE_URL}/api`,
    changeOrigin: true,
  })
);

// Socket.IO for live notifications. notification-service serves it at /api/socket.io on its
// HTTP port; clients reach it through the gateway at /notification/socket.io, so the
// access_token cookie for this origin rides along on the handshake.
//
// Mounted at the root with a pathFilter rather than under '/notification', because
// WebSocket upgrades never pass through Express: they are handled by the server's 'upgrade'
// event below, which sees the full, unstripped path. `ws` is deliberately not set — that
// would make the proxy subscribe to 'upgrade' itself on the first HTTP request, and every
// upgrade would then be proxied twice.
const notificationSocketProxy = createProxyMiddleware({
  target: NOTIFICATION_SERVICE_URL,
  changeOrigin: true,
  pathFilter: '/notification/socket.io',
  pathRewrite: { '^/notification/socket.io': '/api/socket.io' },
});
app.use(notificationSocketProxy);

// Same bare /api target as /order: notification-service mounts its router at /api, so
// /notification/notifications arrives as /api/notifications.
app.use(
  '/notification',
  createProxyMiddleware({
    target: `${NOTIFICATION_SERVICE_URL}/api`,
    changeOrigin: true,
  })
);

app.use(errorMiddleware);

const port = process.env.PORT || 8080;
const server = app.listen(port, () => {
  console.log(`Listening at http://localhost:${port}`);
});
server.on('error', console.error);
server.on('upgrade', notificationSocketProxy.upgrade);
