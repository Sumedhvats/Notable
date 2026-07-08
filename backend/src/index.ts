import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import passport from 'passport';
import mongoose from 'mongoose';

import logger from './utils/logger.js';
import { configurePassport } from './config/passport.js';
import authRoutes from './routes/auth.routes.js';

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Sessions — needed for Passport OAuth handshake (transient, not for auth state)
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 10 * 60 * 1000, // 10 min — only used during OAuth flow
  },
}));

// Passport
configurePassport();
app.use(passport.initialize());
app.use(passport.session());

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Auth
app.use('/api/v1/auth', authRoutes);

// ---------------------------------------------------------------------------
// Global Error Handler
// ---------------------------------------------------------------------------

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error:', err.message);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'production' ? undefined : err.message,
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const start = async () => {
  try {
    // Connect to MongoDB
    const mongoUrl = process.env.MONGODB_URL;
    if (!mongoUrl || !mongoUrl.startsWith('mongodb')) {
      logger.warn('MONGODB_URL not set or invalid — running without database');
    } else {
      await mongoose.connect(mongoUrl);
      logger.success(`Connected to MongoDB`);
    }

    app.listen(PORT, () => {
      logger.success(`Server running on http://localhost:${PORT}`);
      logger.info(`Health check: http://localhost:${PORT}/health`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

start();

export default app;
