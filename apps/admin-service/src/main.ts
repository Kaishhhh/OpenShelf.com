import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import * as path from 'path';
import { errorMiddleware } from '@openshelf/errors';
import { adminAuthRouter } from './routes/admin-auth.router.js';
import { shopModerationRouter } from './routes/shop-moderation.router.js';

const app = express();

app.use(express.json());
app.use(cookieParser());
app.use('/assets', express.static(path.join(__dirname, 'assets')));

app.get('/api', (req, res) => {
  res.send({ message: 'Welcome to admin-service!' });
});

app.use('/api', adminAuthRouter);
app.use('/api', shopModerationRouter);

app.use(errorMiddleware);

const port = process.env.PORT || 6007;
const server = app.listen(port, () => {
  console.log(`Listening at http://localhost:${port}/api`);
});
server.on('error', console.error);
