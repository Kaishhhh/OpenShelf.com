import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import * as path from 'path';
import { errorMiddleware } from '@openshelf/errors';
import { sendPush } from '@openshelf/firebase';
import type { RunningConsumer } from '@openshelf/kafka';
import { notificationRouter } from './routes/notification.router.js';
import { startConsumers } from './consumers/start.js';
import { setNotificationDelivery } from './consumers/order-events.handler.js';
import { createDeliverer } from './delivery/deliver.js';
import { loadTokens, removeTokens } from './delivery/fcm-tokens.js';
import { createRealtime, getRealtime, setRealtime } from './realtime/socket.js';

const USER_UI_URL = process.env.USER_UI_URL || 'http://localhost:3000';
const SELLER_UI_URL = process.env.SELLER_UI_URL || 'http://localhost:3001';

const app = express();

app.use(express.json());
app.use(cookieParser());
app.use('/assets', express.static(path.join(__dirname, 'assets')));

app.get('/api', (req, res) => {
  res.send({ message: 'Welcome to notification-service!' });
});

app.use('/api', notificationRouter);

app.use(errorMiddleware);

const port = process.env.PORT || 6005;
const server = app.listen(port, () => {
  console.log(`Listening at http://localhost:${port}/api`);
});
server.on('error', console.error);

// Socket.IO shares the HTTP server, so it answers on the same port under /api/socket.io.
const realtime = createRealtime(server, { corsOrigins: [USER_UI_URL, SELLER_UI_URL] });
setRealtime(realtime);

setNotificationDelivery(
  createDeliverer({
    realtime: getRealtime,
    sendPush,
    loadTokens,
    removeTokens,
    uiUrl: (role) => (role === 'SELLER' ? SELLER_UI_URL : USER_UI_URL),
  })
);

// KAFKA_CONSUMERS_ENABLED=false runs a web-only replica: it serves HTTP and sockets and
// relies on the Redis adapter to receive emits from whichever instance consumed the event.
const consumersEnabled = process.env.KAFKA_CONSUMERS_ENABLED?.trim().toLowerCase() !== 'false';

// The HTTP side does not depend on Kafka: a broker that is unreachable at startup leaves
// the notification feeds readable, and the failure logged, rather than the process down.
let consumers: RunningConsumer[] = [];
if (consumersEnabled) {
  startConsumers()
    .then((running) => {
      consumers = running;
    })
    .catch((err) => {
      console.error('[kafka] consumers failed to start — no events will be processed:', err);
    });
} else {
  console.log('[kafka] consumers disabled (KAFKA_CONSUMERS_ENABLED=false); web-only replica');
}

async function shutdown(signal: string) {
  console.log(`${signal} received, disconnecting consumers and sockets`);
  await Promise.allSettled(consumers.map((consumer) => consumer.disconnect()));
  // Closes the HTTP server as well — Socket.IO owns the one it is attached to.
  await realtime.close().catch(() => undefined);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
