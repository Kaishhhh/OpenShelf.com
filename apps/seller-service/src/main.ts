
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import * as path from 'path';
import { errorMiddleware } from '@openshelf/errors';
import { sellerAuthRouter } from './routes/seller-auth.router.js';


const app = express();

app.use(cors({
  origin: process.env.SELLER_UI_URL || 'http://localhost:3001',
  credentials: true,
}));

app.use(express.json());
app.use(cookieParser());
app.use('/assets', express.static(path.join(__dirname, 'assets')));

app.get('/api', (req, res) => {
  res.send({ message: 'Welcome to seller-service!' });
});

app.use('/api', sellerAuthRouter);

app.use(errorMiddleware);

const port = process.env.PORT || 6003;
const server = app.listen(port, () => {
  console.log(`Listening at http://localhost:${port}/api`);
});
server.on('error', console.error);
