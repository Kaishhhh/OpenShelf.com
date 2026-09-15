
import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import * as path from 'path';
import { errorMiddleware } from '@openshelf/errors';
import { sellerAuthRouter } from './routes/seller-auth.router.js';
import { shopRouter } from './routes/shop.router.js';
import { stripeRouter } from './routes/stripe.router.js';
import { handleStripeWebhook } from './controllers/stripe.controller.js';


const app = express();

// Must be registered before express.json(). Stripe signs the exact bytes it
// sent; a JSON parser running first would consume them and leave nothing to
// verify, failing every signature check. express.raw hands the handler a Buffer.
app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  handleStripeWebhook
);

app.use(express.json());
app.use(cookieParser());
app.use('/assets', express.static(path.join(__dirname, 'assets')));

app.get('/api', (req, res) => {
  res.send({ message: 'Welcome to seller-service!' });
});

app.use('/api', sellerAuthRouter);
app.use('/api', shopRouter);
app.use('/api', stripeRouter);

app.use(errorMiddleware);

const port = process.env.PORT || 6003;
const server = app.listen(port, () => {
  console.log(`Listening at http://localhost:${port}/api`);
});
server.on('error', console.error);
