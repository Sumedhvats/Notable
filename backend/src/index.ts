import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { v4 as uuid } from 'uuid';
import { toNodeHandler } from 'better-auth/node';

import logger from './utils/logger.js';
import { initAuth, closeAuth } from './lib/auth.js';
import { defaultLimiter } from './middleware/rateLimit.middleware.js';
import memoryRouter from './routes/memory.routes.js';
import askRouter from './routes/ask.routes.js';
import { memoryWorker } from './workers/memory.worker.js';
import { redis } from './config/queue.js';

const app = express();
const PORT = process.env.PORT || 5000;

const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS || '30000', 10);

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));

app.use(defaultLimiter);

app.use((req, _res, next) => {
  const requestId = (req.headers['x-request-id'] as string) || uuid();
  req.headers['x-request-id'] = requestId;
  next();
});

app.use((req, res, next) => {
  const timer = setTimeout(() => {
    res.status(503).json({ error: 'Request timeout' });
  }, REQUEST_TIMEOUT_MS);
  res.on('finish', () => clearTimeout(timer));
  next();
});

// Better Auth handler must be mounted BEFORE body parsers consume the stream
// Use a placeholder; the real auth handler gets mounted in start()
let _authHandler: any = null;
app.all('/api/auth/*', (req, res, next) => {
  if (_authHandler) return _authHandler(req, res);
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Register endpoints
app.use('/api', memoryRouter);
app.use('/api', askRouter);

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

async function gracefulShutdown(signal: string) {
  logger.info(`${signal} received — starting graceful shutdown`);
  try {
    // 1. Drain worker and close it so no new jobs are accepted
    await memoryWorker.close();
    logger.info('BullMQ worker closed (active jobs drained)');
  } catch (err) {
    logger.error('Error closing worker:', (err as Error).message);
  }

  server.close(async () => {
    logger.info('HTTP server closed');
    try {
      await closeAuth();
      logger.info('Auth client closed');
    } catch (err) {
      logger.error('Error closing auth client:', err);
    }
    try {
      await mongoose.disconnect();
      logger.info('MongoDB disconnected');
    } catch (err) {
      logger.error('Error disconnecting MongoDB:', err);
    }
    try {
      // 2. Quit redis connection
      await redis.quit();
      logger.info('Redis connection closed');
    } catch (err) {
      logger.error('Error closing Redis connection:', err);
    }
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Graceful shutdown timeout — forcing exit');
    process.exit(1);
  }, 10000);
}

let server: ReturnType<typeof app.listen>;

const start = async () => {
  try {
    const mongoUrl = process.env.MONGODB_URL;
    if (!mongoUrl || !mongoUrl.startsWith('mongodb')) {
      logger.warn('MONGODB_URL not set or invalid — running without database');
    } else {
      await mongoose.connect(mongoUrl, { serverSelectionTimeoutMS: 5000 });
      logger.success('Connected to MongoDB');

      const auth = initAuth();
      logger.success('Better Auth initialized');
      _authHandler = toNodeHandler(auth);
    }

    // Ping Redis to verify connection before starting the worker
    try {
      await redis.ping();
      logger.success('Connected to Redis');
    } catch (redisErr) {
      logger.warn(`Redis connection failed: ${(redisErr as Error).message}. BullMQ will run in background and auto-reconnect.`);
    }

    server = app.listen(PORT, () => {
      logger.success(`Server running on http://localhost:${PORT}`);
      logger.info(`Health check: http://localhost:${PORT}/health`);
    });

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

start();

// Error handler must be LAST in the middleware stack
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error:', err.message);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'production' ? undefined : err.message,
  });
});

export default app;
