import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import * as path from 'path';
import { errorMiddleware } from '@openshelf/errors';
import { cartRouter } from './routes/cart.router.js';
import { orderRouter } from './routes/order.router.js';
import { sellerOrderRouter } from './routes/seller-order.router.js';
import { handlePaymentsWebhook } from './controllers/webhook.controller.js';

const app = express();

// Must be registered before express.json(): Stripe signs the exact bytes it sent, and a
// JSON parser running first would leave nothing to verify. It must also come before
// cartRouter, whose router-level isAuthenticated runs for every /api request that
// reaches it and would 401 Stripe.
app.post(
  '/api/webhook',
  express.raw({ type: 'application/json' }),
  handlePaymentsWebhook
);

app.use(express.json());
app.use(cookieParser());
app.use('/assets', express.static(path.join(__dirname, 'assets')));

app.get('/api', (req, res) => {
  res.send({ message: 'Welcome to order-service!' });
});

// Ahead of cartRouter for the same reason as the webhook: its router-level
// isAuthenticated would otherwise run first. These routes authenticate themselves.
app.use('/api', orderRouter);
app.use('/api', sellerOrderRouter);
app.use('/api', cartRouter);

app.use(errorMiddleware);

const port = process.env.PORT || 6004;
const server = app.listen(port, () => {
  console.log(`Listening at http://localhost:${port}/api`);
});
server.on('error', console.error);
