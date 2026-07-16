import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import api from './routes/index.js';
import { errorHandler } from './middleware/error.js';

export function createApp() {
  const app = express();

  app.use(helmet({ crossOriginResourcePolicy: false }));
  app.use(cors({ origin: env.clientOrigin, credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: '10mb' }));
  app.use(cookieParser());
  if (!env.isProd) app.use(morgan('dev'));

  // Basic rate limiting on the API surface.
  app.use(
    '/api',
    rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false }),
  );

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'meridian', aiEnabled: env.aiEnabled, time: new Date().toISOString() });
  });

  app.use('/api', api);

  app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));
  app.use(errorHandler);

  return app;
}
